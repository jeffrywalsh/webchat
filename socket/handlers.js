// socket/handlers.js - Enhanced Socket.io event handlers with robust online status management
const { userQueries, roomQueries, messageQueries, queryOne, query } = require('../config/database');

// Store connected users with more detailed tracking
const connectedUsers = new Map();
const userSessions = new Map(); // Track multiple sessions per user

function socketHandlers(io, socket) {
    const userId = socket.request.session.userId;
    const username = socket.request.session.username;

    console.log('🔧 Initializing enhanced handlers for:', { userId, username });

    // Store connected users with session tracking
    const sessionData = {
        socketId: socket.id,
        username,
        joinedAt: new Date(),
        lastSeen: new Date()
    };

    connectedUsers.set(userId, sessionData);

    // Track multiple sessions per user
    if (!userSessions.has(userId)) {
        userSessions.set(userId, new Set());
    }
    userSessions.get(userId).add(socket.id);

    console.log(`👤 User connected: ${username} (${socket.id})`);
    console.log(`📊 Active sessions for ${username}: ${userSessions.get(userId).size}`);

    // Enhanced status broadcasting
    async function broadcastStatusUpdate(targetUserId, status) {
        try {
            const user = await userQueries.findById(targetUserId);
            if (!user) return;

            console.log(`📡 Broadcasting status update: ${user.username} is now ${status}`);

            // Broadcast to all connected sockets
            io.emit('user_status_changed', {
                userId: targetUserId,
                username: user.username,
                displayName: user.display_name,
                status: status
            });

            // Trigger friends list updates for all users
            io.emit('refresh_friends_status');

            // Update room users for all rooms this user is in
            const userRooms = await roomQueries.getUserRooms(targetUserId);
            for (const room of userRooms) {
                io.to(`room_${room.id}`).emit('refresh_room_users');
            }

        } catch (error) {
            console.error('Error broadcasting status update:', error);
        }
    }

    // Enhanced user initialization with better status handling
    async function initializeUser() {
        try {
            // Update status to online in database
            await userQueries.updateStatus(userId, 'online');
            console.log(`✅ Updated ${username} status to online in database`);

            // Get user's rooms and join them
            const userRooms = await roomQueries.getUserRooms(userId);
            for (const room of userRooms) {
                socket.join(`room_${room.id}`);
                console.log(`📝 ${username} joined room: ${room.display_name}`);
            }

            // Send user their rooms list
            socket.emit('rooms_list', userRooms);

            // Send DM conversations
            await sendDMConversations();

            // Send initial friends list
            await sendFriendsList();

            // Send pending friend requests count
            await sendFriendRequestsCount();

            // Broadcast that user is online to everyone
            await broadcastStatusUpdate(userId, 'online');

            // Send updated online users to this user
            await sendOnlineUsers();

            console.log(`🎉 ${username} fully initialized and status broadcasted`);

        } catch (error) {
            console.error('User initialization error:', error);
            socket.emit('error', 'Failed to initialize user');
        }
    }

    // Send friends list to user
    async function sendFriendsList() {
        try {
            const friends = await query(`
                SELECT
                    f.id as friendship_id,
                    f.created_at as friends_since,
                    CASE
                        WHEN f.requester_id = ? THEN f.addressee_id
                        ELSE f.requester_id
                        END as friend_id,
                    CASE
                        WHEN f.requester_id = ? THEN u2.username
                        ELSE u1.username
                        END as username,
                    CASE
                        WHEN f.requester_id = ? THEN u2.display_name
                        ELSE u1.display_name
                        END as display_name,
                    CASE
                        WHEN f.requester_id = ? THEN u2.avatar_url
                        ELSE u1.avatar_url
                        END as avatar_url,
                    CASE
                        WHEN f.requester_id = ? THEN u2.status
                        ELSE u1.status
                        END as status,
                    CASE
                        WHEN f.requester_id = ? THEN u2.last_seen
                        ELSE u1.last_seen
                        END as last_seen
                FROM friends f
                         JOIN users u1 ON f.requester_id = u1.id
                         JOIN users u2 ON f.addressee_id = u2.id
                WHERE (f.requester_id = ? OR f.addressee_id = ?)
                  AND f.status = 'accepted'
                  AND u1.is_active = TRUE
                  AND u2.is_active = TRUE
                ORDER BY status DESC, display_name ASC
            `, [userId, userId, userId, userId, userId, userId, userId, userId]);

            socket.emit('friends_list_updated', { friends });
        } catch (error) {
            console.error('Error fetching friends list:', error);
        }
    }

    // Send friend requests count
    async function sendFriendRequestsCount() {
        try {
            const result = await queryOne(`
                SELECT COUNT(*) as count
                FROM friends f
                         JOIN users u ON f.requester_id = u.id
                WHERE f.addressee_id = ?
                  AND f.status = 'pending'
                  AND u.is_active = TRUE
            `, [userId]);

            socket.emit('friend_requests_count_updated', { count: result.count });
        } catch (error) {
            console.error('Error fetching friend requests count:', error);
        }
    }

    // Enhanced online users with real-time status
    async function sendOnlineUsers() {
        try {
            const onlineUsers = await query(`
                SELECT id, username, display_name, avatar_url, status, last_seen
                FROM users
                WHERE status = 'online' AND is_active = TRUE
                ORDER BY display_name
            `);

            socket.emit('online_users', onlineUsers);
            console.log(`📤 Sent ${onlineUsers.length} online users to ${username}`);
        } catch (error) {
            console.error('Error fetching online users:', error);
        }
    }

    // Send DM conversations to user
    async function sendDMConversations() {
        try {
            const conversations = await getDMConversationsForUser(userId);
            socket.emit('dm_conversations', conversations);
        } catch (error) {
            console.error('Error fetching DM conversations:', error);
        }
    }

    // Get DM conversations for a specific user (respecting hidden/deleted status)
    async function getDMConversationsForUser(targetUserId) {
        const conversations = await query(`
            SELECT
                dc.*,
                CASE
                    WHEN dc.user1_id = ? THEN dc.user2_id
                    ELSE dc.user1_id
                    END as other_user_id,
                CASE
                    WHEN dc.user1_id = ? THEN u2.username
                    ELSE u1.username
                    END as other_username,
                CASE
                    WHEN dc.user1_id = ? THEN u2.display_name
                    ELSE u1.display_name
                    END as other_display_name,
                CASE
                    WHEN dc.user1_id = ? THEN u2.avatar_url
                    ELSE u1.avatar_url
                    END as other_avatar_url,
                CASE
                    WHEN dc.user1_id = ? THEN u2.status
                    ELSE u1.status
                    END as other_status
            FROM dm_conversations dc
                     JOIN users u1 ON dc.user1_id = u1.id
                     JOIN users u2 ON dc.user2_id = u2.id
            WHERE (dc.user1_id = ? OR dc.user2_id = ?)
              AND dc.is_active = TRUE
              AND (
                (dc.user1_id = ? AND (dc.user1_hidden IS NULL OR dc.user1_hidden = FALSE) AND dc.user1_deleted_at IS NULL) OR
                (dc.user2_id = ? AND (dc.user2_hidden IS NULL OR dc.user2_hidden = FALSE) AND dc.user2_deleted_at IS NULL)
                )
            ORDER BY dc.last_message_at DESC
        `, [targetUserId, targetUserId, targetUserId, targetUserId, targetUserId, targetUserId, targetUserId, targetUserId, targetUserId]);

        return conversations.map(conv => ({
            id: conv.id,
            last_message_at: conv.last_message_at,
            other_user: {
                id: conv.other_user_id,
                username: conv.other_username,
                display_name: conv.other_display_name,
                avatar_url: conv.other_avatar_url,
                status: conv.other_status
            }
        }));
    }

    // Notify user about friend-related events
    function notifyUser(targetUserId, event, data) {
        const targetConnection = Array.from(connectedUsers.entries())
            .find(([id, connection]) => id == targetUserId);

        if (targetConnection) {
            const targetSocketId = targetConnection[1].socketId;
            io.to(targetSocketId).emit(event, data);
        }
    }

    // Update friends list for multiple users
    async function updateFriendsForUsers(userIds) {
        for (const targetUserId of userIds) {
            const targetConnection = Array.from(connectedUsers.entries())
                .find(([id, connection]) => id == targetUserId);

            if (targetConnection) {
                const targetSocketId = targetConnection[1].socketId;
                const friends = await query(`
                    SELECT
                        f.id as friendship_id,
                        f.created_at as friends_since,
                        CASE
                            WHEN f.requester_id = ? THEN f.addressee_id
                            ELSE f.requester_id
                            END as friend_id,
                        CASE
                            WHEN f.requester_id = ? THEN u2.username
                            ELSE u1.username
                            END as username,
                        CASE
                            WHEN f.requester_id = ? THEN u2.display_name
                            ELSE u1.display_name
                            END as display_name,
                        CASE
                            WHEN f.requester_id = ? THEN u2.avatar_url
                            ELSE u1.avatar_url
                            END as avatar_url,
                        CASE
                            WHEN f.requester_id = ? THEN u2.status
                            ELSE u1.status
                            END as status
                    FROM friends f
                             JOIN users u1 ON f.requester_id = u1.id
                             JOIN users u2 ON f.addressee_id = u2.id
                    WHERE (f.requester_id = ? OR f.addressee_id = ?)
                      AND f.status = 'accepted'
                      AND u1.is_active = TRUE
                      AND u2.is_active = TRUE
                    ORDER BY status DESC, display_name ASC
                `, [targetUserId, targetUserId, targetUserId, targetUserId, targetUserId, targetUserId, targetUserId]);

                io.to(targetSocketId).emit('friends_list_updated', { friends });

                // Update friend requests count
                const result = await queryOne(`
                    SELECT COUNT(*) as count
                    FROM friends f
                             JOIN users u ON f.requester_id = u.id
                    WHERE f.addressee_id = ?
                      AND f.status = 'pending'
                      AND u.is_active = TRUE
                `, [targetUserId]);

                io.to(targetSocketId).emit('friend_requests_count_updated', { count: result.count });
            }
        }
    }

    // Handle joining a specific room
    socket.on('join_room', async (data) => {
        try {
            const { roomId } = data;

            // Check if user has access to room
            const membership = await queryOne(
                'SELECT role FROM room_members WHERE room_id = ? AND user_id = ? AND is_active = TRUE',
                [roomId, userId]
            );

            if (!membership) {
                socket.emit('error', 'Access denied to room');
                return;
            }

            socket.join(`room_${roomId}`);

            // Get recent messages for the room
            const messages = await messageQueries.getRoomMessages(roomId, 50, 0);
            socket.emit('room_messages', {
                roomId,
                messages: messages.reverse()
            });

            // Send room users when joining with updated status
            const roomUsers = await query(`
                SELECT u.id, u.username, u.display_name, u.avatar_url, u.status, rm.role, u.last_seen
                FROM users u
                         JOIN room_members rm ON u.id = rm.user_id
                WHERE rm.room_id = ? AND rm.is_active = TRUE AND u.is_active = TRUE
                ORDER BY
                    CASE rm.role
                        WHEN 'owner' THEN 1
                        WHEN 'admin' THEN 2
                        ELSE 3
                        END,
                    u.status DESC,
                    u.username
            `, [roomId]);

            socket.emit('room_users', {
                roomId,
                users: roomUsers
            });

            console.log(`📝 ${username} joined room ${roomId} with ${roomUsers.length} users`);

        } catch (error) {
            console.error('Join room error:', error);
            socket.emit('error', 'Failed to join room');
        }
    });

    // Handle leaving a room with proper cleanup and rooms list refresh
    socket.on('leave_room', async (data) => {
        try {
            const { roomId } = data;

            // Leave the socket room
            socket.leave(`room_${roomId}`);
            console.log(`📝 ${username} left room ${roomId}`);

            // Send updated rooms list to the user
            const userRooms = await roomQueries.getUserRooms(userId);
            socket.emit('rooms_list', userRooms);

            console.log(`✅ Updated rooms list sent to ${username} after leaving room ${roomId}`);

        } catch (error) {
            console.error('Error handling leave room:', error);
            socket.emit('error', 'Failed to leave room');
        }
    });

    // Handle explicit request for user rooms
    socket.on('get_user_rooms', async () => {
        try {
            const userRooms = await roomQueries.getUserRooms(userId);
            socket.emit('rooms_list', userRooms);
            console.log(`✅ Sent updated rooms list to ${username}`);
        } catch (error) {
            console.error('Error getting user rooms:', error);
            socket.emit('error', 'Failed to get rooms list');
        }
    });

    // Handle getting room users with force refresh capability
    socket.on('get_room_users', async (data) => {
        try {
            const { roomId } = data;

            // Check if user has access to room
            const membership = await queryOne(
                'SELECT role FROM room_members WHERE room_id = ? AND user_id = ? AND is_active = TRUE',
                [roomId, userId]
            );

            if (!membership) {
                socket.emit('error', 'Access denied to room');
                return;
            }

            // Get users in this room with fresh status data
            const roomUsers = await query(`
                SELECT u.id, u.username, u.display_name, u.avatar_url, u.status, rm.role, u.last_seen
                FROM users u
                         JOIN room_members rm ON u.id = rm.user_id
                WHERE rm.room_id = ? AND rm.is_active = TRUE AND u.is_active = TRUE
                ORDER BY
                    CASE rm.role
                        WHEN 'owner' THEN 1
                        WHEN 'admin' THEN 2
                        ELSE 3
                        END,
                    u.status DESC,
                    u.username
            `, [roomId]);

            socket.emit('room_users', {
                roomId,
                users: roomUsers
            });

            console.log(`📝 Sent room users for room ${roomId} to ${username} (${roomUsers.length} users)`);

        } catch (error) {
            console.error('Get room users error:', error);
            socket.emit('error', 'Failed to get room users');
        }
    });

    // Handle getting online users with force refresh
    socket.on('get_online_users', async () => {
        try {
            await sendOnlineUsers();
        } catch (error) {
            console.error('Get online users error:', error);
            socket.emit('error', 'Failed to get online users');
        }
    });

    // Handle getting DM conversations
    socket.on('get_dm_conversations', async () => {
        try {
            await sendDMConversations();
        } catch (error) {
            console.error('Get DM conversations error:', error);
            socket.emit('error', 'Failed to get DM conversations');
        }
    });

    // Handle getting friends list
    socket.on('get_friends_list', async () => {
        try {
            await sendFriendsList();
        } catch (error) {
            console.error('Get friends list error:', error);
            socket.emit('error', 'Failed to get friends list');
        }
    });

    // Handle getting friend requests count
    socket.on('get_friend_requests_count', async () => {
        try {
            await sendFriendRequestsCount();
        } catch (error) {
            console.error('Get friend requests count error:', error);
            socket.emit('error', 'Failed to get friend requests count');
        }
    });

    // NEW: Handle manual status refresh request
    socket.on('refresh_my_status', async () => {
        try {
            console.log(`🔄 Manual status refresh requested by ${username}`);
            await userQueries.updateStatus(userId, 'online');
            await broadcastStatusUpdate(userId, 'online');
            await sendOnlineUsers();
            await sendFriendsList();
        } catch (error) {
            console.error('Manual status refresh error:', error);
        }
    });

    // Handle getting DM messages
    socket.on('get_dm_messages', async (data) => {
        try {
            const { recipientId, limit = 50, offset = 0 } = data;

            console.log(`📬 Getting DM messages between ${username} (${userId}) and user ${recipientId}`);

            const messages = await messageQueries.getDMMessages(userId, recipientId, limit, offset);

            console.log(`📬 Found ${messages.length} DM messages`);

            socket.emit('dm_messages', {
                recipientId,
                messages: messages.reverse()
            });

            console.log(`✅ Sent DM messages between ${username} and user ${recipientId}`);

        } catch (error) {
            console.error('Get DM messages error:', error);
            socket.emit('error', 'Failed to load messages');
        }
    });

    // Handle sending direct messages
    socket.on('send_dm', async (data) => {
        console.log('📨 DM received from client:', { userId, username, data });

        try {
            const { recipientId, content, messageType = 'text' } = data;

            // Validate message
            if (!content || content.trim().length === 0) {
                console.log('❌ Empty DM content');
                socket.emit('error', 'Message content is required');
                return;
            }

            if (content.length > 2000) {
                console.log('❌ DM too long');
                socket.emit('error', 'Message too long (max 2000 characters)');
                return;
            }

            // Verify recipient exists
            const recipient = await userQueries.findById(recipientId);
            if (!recipient) {
                socket.emit('error', 'Recipient not found');
                return;
            }

            // Create or find DM conversation with proper user ordering
            const user1Id = Math.min(userId, recipientId);
            const user2Id = Math.max(userId, recipientId);

            let conversation = await queryOne(
                'SELECT id FROM dm_conversations WHERE user1_id = ? AND user2_id = ? AND is_active = TRUE',
                [user1Id, user2Id]
            );

            if (!conversation) {
                const result = await query(
                    'INSERT INTO dm_conversations (user1_id, user2_id) VALUES (?, ?)',
                    [user1Id, user2Id]
                );
                conversation = { id: result.insertId };
            }

            // Save message
            const messageData = {
                sender_id: userId,
                room_id: null,
                recipient_id: recipientId,
                message_type: messageType,
                content: content.trim(),
                file_url: null,
                file_name: null,
                file_size: null,
                link_title: null,
                link_description: null,
                link_image: null
            };

            const messageId = await messageQueries.create(messageData);
            console.log('✅ DM saved with ID:', messageId);

            // Get sender info
            const sender = await userQueries.findById(userId);

            // Create message object
            const messageToSend = {
                id: messageId,
                sender_id: userId,
                recipient_id: recipientId,
                message_type: messageType,
                content: messageData.content,
                username: sender.username,
                display_name: sender.display_name,
                avatar_url: sender.avatar_url,
                created_at: new Date()
            };

            // Send to sender
            socket.emit('new_dm', messageToSend);

            // Send to recipient if online
            const recipientConnection = Array.from(connectedUsers.entries())
                .find(([id, connection]) => id == recipientId);

            if (recipientConnection) {
                const recipientSocketId = recipientConnection[1].socketId;
                io.to(recipientSocketId).emit('new_dm', messageToSend);
                console.log(`📤 DM sent to recipient ${recipient.username}`);
            } else {
                console.log(`📤 Recipient ${recipient.username} is offline`);
            }

            // Update conversation
            await query(
                'UPDATE dm_conversations SET last_message_id = ?, last_message_at = CURRENT_TIMESTAMP WHERE id = ?',
                [messageId, conversation.id]
            );

            // Send updated DM conversations to both users
            await sendDMConversations();
            if (recipientConnection) {
                const recipientSocketId = recipientConnection[1].socketId;
                const recipientConversations = await getDMConversationsForUser(recipientId);
                io.to(recipientSocketId).emit('dm_conversations', recipientConversations);
            }

            console.log(`✅ DM sent from ${username} to ${recipient.username}`);

        } catch (error) {
            console.error('❌ Send DM error:', error);
            console.error('Error stack:', error.stack);
            socket.emit('error', 'Failed to send direct message: ' + error.message);
        }
    });

    // Handle sending messages
    socket.on('send_message', async (data) => {
        console.log('📨 Attempting to send message:', { userId, data });

        try {
            const { roomId, content, messageType = 'text' } = data;

            // Validate message content
            if (!content || content.trim().length === 0) {
                socket.emit('error', 'Message content is required');
                return;
            }

            if (content.length > 2000) {
                socket.emit('error', 'Message too long (max 2000 characters)');
                return;
            }

            console.log('🔍 Checking room access for user:', userId, 'room:', roomId);

            // Check if user has access to this room
            const membership = await queryOne(
                'SELECT role FROM room_members WHERE room_id = ? AND user_id = ? AND is_active = TRUE',
                [roomId, userId]
            );

            console.log('🏠 Room membership result:', membership);

            if (!membership) {
                socket.emit('error', 'Access denied to room');
                return;
            }

            // Create message data
            const messageData = {
                sender_id: userId,
                room_id: roomId,
                recipient_id: null,
                message_type: messageType,
                content: content.trim(),
                file_url: null,
                file_name: null,
                file_size: null,
                link_title: null,
                link_description: null,
                link_image: null
            };

            console.log('💾 Saving message to database');

            // Save message to database
            const messageId = await messageQueries.create(messageData);
            console.log('✅ Message saved with ID:', messageId);

            // Get sender info
            const user = await userQueries.findById(userId);
            console.log('👤 Got user info:', user.username);

            // Create message object to send to clients
            const messageToSend = {
                id: messageId,
                sender_id: userId,
                room_id: roomId,
                message_type: messageData.message_type,
                content: messageData.content,
                username: user.username,
                display_name: user.display_name,
                avatar_url: user.avatar_url,
                created_at: new Date()
            };

            console.log('📤 Broadcasting message to room:', `room_${roomId}`);

            // Send message to all users in the room
            io.to(`room_${roomId}`).emit('new_message', messageToSend);

            console.log(`✅ Message sent by ${username} in room ${roomId}`);

        } catch (error) {
            console.error('❌ Send message error:', error);
            console.error('Error stack:', error.stack);
            socket.emit('error', 'Failed to send message: ' + error.message);
        }
    });

    // Handle typing indicators
    socket.on('typing_start', (data) => {
        const { roomId, recipientId } = data;

        if (roomId) {
            socket.to(`room_${roomId}`).emit('user_typing', {
                userId,
                username,
                roomId
            });
        } else if (recipientId) {
            const recipientConnection = Array.from(connectedUsers.entries())
                .find(([id, connection]) => id == recipientId);

            if (recipientConnection) {
                const recipientSocketId = recipientConnection[1].socketId;
                io.to(recipientSocketId).emit('user_typing', {
                    userId,
                    username,
                    recipientId
                });
            }
        }
    });

    socket.on('typing_stop', (data) => {
        const { roomId, recipientId } = data;

        if (roomId) {
            socket.to(`room_${roomId}`).emit('user_stopped_typing', {
                userId,
                username,
                roomId
            });
        } else if (recipientId) {
            const recipientConnection = Array.from(connectedUsers.entries())
                .find(([id, connection]) => id == recipientId);

            if (recipientConnection) {
                const recipientSocketId = recipientConnection[1].socketId;
                io.to(recipientSocketId).emit('user_stopped_typing', {
                    userId,
                    username,
                    recipientId
                });
            }
        }
    });

    // Enhanced disconnect handling with proper cleanup
    socket.on('disconnect', async (reason) => {
        console.log(`👋 User disconnecting: ${username} (${socket.id}) - Reason: ${reason}`);

        try {
            // Remove this socket from user sessions
            if (userSessions.has(userId)) {
                userSessions.get(userId).delete(socket.id);
                console.log(`📊 Remaining sessions for ${username}: ${userSessions.get(userId).size}`);

                // If no more sessions for this user, mark as offline
                if (userSessions.get(userId).size === 0) {
                    userSessions.delete(userId);
                    connectedUsers.delete(userId);

                    console.log(`🔴 ${username} has no more active sessions, marking offline`);

                    // Update status to offline
                    await userQueries.updateStatus(userId, 'offline');

                    // Broadcast offline status to everyone
                    await broadcastStatusUpdate(userId, 'offline');

                } else {
                    console.log(`🟡 ${username} still has active sessions, keeping online`);
                }
            }

        } catch (error) {
            console.error('Disconnect handling error:', error);
        }
    });

    // Initialize the user when they connect
    initializeUser();

    // Expose helper functions for use by other modules
    socket.updateFriendsForUsers = updateFriendsForUsers;
    socket.notifyUser = notifyUser;
    socket.sendFriendRequestsCount = sendFriendRequestsCount;
    socket.broadcastStatusUpdate = broadcastStatusUpdate;
}

module.exports = socketHandlers;