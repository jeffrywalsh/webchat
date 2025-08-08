// socket/handlers.js - Enhanced Socket.io event handlers
const { userQueries, roomQueries, messageQueries, queryOne, query } = require('../config/database');

// Store connected users
const connectedUsers = new Map();

function socketHandlers(io, socket) {
    const userId = socket.request.session.userId;
    const username = socket.request.session.username;

    console.log('🔧 Initializing enhanced handlers for:', { userId, username });

    // Store connected users
    connectedUsers.set(userId, {
        socketId: socket.id,
        username,
        joinedAt: new Date()
    });

    console.log(`👤 User connected: ${username} (${socket.id})`);

    // Join user to their rooms on connection
    async function initializeUser() {
        try {
            await userQueries.updateStatus(userId, 'online');

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

            // Get and send all online users
            await sendOnlineUsers();

            // Notify others user is online
            socket.broadcast.emit('user_status_changed', {
                userId,
                username,
                status: 'online'
            });

            // Update online users for everyone else
            io.emit('refresh_online_users');

        } catch (error) {
            console.error('User initialization error:', error);
            socket.emit('error', 'Failed to initialize user');
        }
    }

    // Send online users list
    async function sendOnlineUsers() {
        try {
            const onlineUsers = await query(`
                SELECT id, username, display_name, avatar_url, status
                FROM users
                WHERE status = 'online' AND is_active = TRUE
                ORDER BY username
            `);

            socket.emit('online_users', onlineUsers);
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

            // Send room users when joining
            const roomUsers = await query(`
                SELECT u.id, u.username, u.display_name, u.avatar_url, u.status, rm.role
                FROM users u
                         JOIN room_members rm ON u.id = rm.user_id
                WHERE rm.room_id = ? AND rm.is_active = TRUE AND u.is_active = TRUE
                ORDER BY
                    CASE rm.role
                        WHEN 'owner' THEN 1
                        WHEN 'admin' THEN 2
                        ELSE 3
                        END,
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

    // ENHANCED: Handle leaving a room with proper cleanup and rooms list refresh
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

    // NEW: Handle explicit request for user rooms (for refresh after joining new channels)
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

    // Handle getting room users
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

            // Get users in this room
            const roomUsers = await query(`
                SELECT u.id, u.username, u.display_name, u.avatar_url, u.status, rm.role
                FROM users u
                         JOIN room_members rm ON u.id = rm.user_id
                WHERE rm.room_id = ? AND rm.is_active = TRUE AND u.is_active = TRUE
                ORDER BY
                    CASE rm.role
                        WHEN 'owner' THEN 1
                        WHEN 'admin' THEN 2
                        ELSE 3
                        END,
                    u.username
            `, [roomId]);

            socket.emit('room_users', {
                roomId,
                users: roomUsers
            });

            console.log(`📝 Sent room users for room ${roomId} to ${username}`);

        } catch (error) {
            console.error('Get room users error:', error);
            socket.emit('error', 'Failed to get room users');
        }
    });

    // Handle getting online users
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

    // Handle user disconnect
    socket.on('disconnect', async () => {
        console.log(`👋 User disconnected: ${username} (${socket.id})`);

        try {
            // Remove from connected users
            connectedUsers.delete(userId);

            // Update status to offline if no other connections
            const stillConnected = Array.from(connectedUsers.entries())
                .some(([id]) => id == userId);

            if (!stillConnected) {
                await userQueries.updateStatus(userId, 'offline');

                // Notify others that user is offline
                socket.broadcast.emit('user_status_changed', {
                    userId,
                    username,
                    status: 'offline'
                });

                // Update online users for everyone
                io.emit('refresh_online_users');
            }

        } catch (error) {
            console.error('Disconnect handling error:', error);
        }
    });

    // Initialize the user when they connect
    initializeUser();
}

module.exports = socketHandlers;