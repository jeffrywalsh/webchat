// routes/messages.js - Enhanced Message handling routes with DM deletion
const express = require('express');
const { messageQueries, queryOne, query } = require('../config/database');

const router = express.Router();

// Helper to get socket.io instance - will be set by server.js
let io = null;
function setSocketIO(socketIO) {
    io = socketIO;
}

// Helper to notify users via socket
function notifyUserViaSocket(userId, event, data) {
    if (!io) return;

    // Find the user's socket connection
    const userSockets = io.sockets.sockets;
    for (const [socketId, socket] of userSockets) {
        if (socket.request?.session?.userId == userId) {
            socket.emit(event, data);
            break;
        }
    }
}

// Get room messages
router.get('/room/:roomId', async (req, res) => {
    try {
        const { roomId } = req.params;
        const userId = req.session.userId;
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        // Check if user has access to room
        const membership = await queryOne(
            'SELECT role FROM room_members WHERE room_id = ? AND user_id = ? AND is_active = TRUE',
            [roomId, userId]
        );

        if (!membership) {
            return res.status(403).json({ error: 'Access denied to this room' });
        }

        // Get messages
        const messages = await messageQueries.getRoomMessages(roomId, limit, offset);

        res.json({ messages: messages.reverse() });

    } catch (error) {
        console.error('Get room messages error:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// Get DM messages
router.get('/dm/:userId', async (req, res) => {
    try {
        const { userId: otherUserId } = req.params;
        const userId = req.session.userId;
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        // Get messages between users
        const messages = await messageQueries.getDMMessages(userId, otherUserId, limit, offset);

        res.json({ messages: messages.reverse() });

    } catch (error) {
        console.error('Get DM messages error:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// Delete a specific DM message
router.delete('/dm/:messageId', async (req, res) => {
    try {
        const { messageId } = req.params;
        const userId = req.session.userId;
        const { deleteFor = 'me' } = req.body; // 'me' or 'everyone'

        // Get the message and verify ownership
        const message = await queryOne(`
            SELECT m.*, u.username, u.display_name,
                   CASE
                       WHEN m.sender_id = ? THEN m.recipient_id
                       ELSE m.sender_id
                       END as other_user_id
            FROM messages m
                     JOIN users u ON (CASE WHEN m.sender_id = ? THEN m.recipient_id ELSE m.sender_id END) = u.id
            WHERE m.id = ?
              AND m.room_id IS NULL
              AND (m.sender_id = ? OR m.recipient_id = ?)
              AND m.is_deleted = FALSE
        `, [userId, userId, messageId, userId, userId]);

        if (!message) {
            return res.status(404).json({ error: 'Message not found or already deleted' });
        }

        // Only sender can delete for everyone
        if (deleteFor === 'everyone' && message.sender_id !== userId) {
            return res.status(403).json({ error: 'You can only delete your own messages for everyone' });
        }

        let deletionMessage = '';

        if (deleteFor === 'everyone') {
            // Hard delete for everyone
            await query('UPDATE messages SET is_deleted = TRUE, content = "[Message deleted]" WHERE id = ?', [messageId]);
            deletionMessage = 'Message deleted for everyone';

            // Notify the other user
            notifyUserViaSocket(message.other_user_id, 'message_deleted', {
                messageId: messageId,
                deletedBy: 'sender',
                conversationWith: req.session.username
            });

            // Refresh DM messages for both users
            notifyUserViaSocket(userId, 'refresh_dm_messages', { userId: message.other_user_id });
            notifyUserViaSocket(message.other_user_id, 'refresh_dm_messages', { userId: userId });

        } else {
            // Delete for current user only (we'll track this differently)
            // For now, we'll use the same approach but could extend with user-specific deletion tracking
            await query('UPDATE messages SET is_deleted = TRUE WHERE id = ?', [messageId]);
            deletionMessage = 'Message deleted for you';

            // Only refresh for current user
            notifyUserViaSocket(userId, 'refresh_dm_messages', { userId: message.other_user_id });
        }

        res.json({
            message: deletionMessage,
            messageId: messageId
        });

    } catch (error) {
        console.error('Delete DM message error:', error);
        res.status(500).json({ error: 'Failed to delete message' });
    }
});

// Delete all messages in a DM conversation
router.delete('/dm/conversation/:userId', async (req, res) => {
    try {
        const { userId: otherUserId } = req.params;
        const userId = req.session.userId;
        const { deleteFor = 'me' } = req.body; // 'me' or 'everyone'

        // Verify the other user exists
        const otherUser = await queryOne(
            'SELECT username, display_name FROM users WHERE id = ? AND is_active = TRUE',
            [otherUserId]
        );

        if (!otherUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Get message count first
        const messageCount = await queryOne(`
            SELECT COUNT(*) as count
            FROM messages
            WHERE ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))
              AND room_id IS NULL
              AND is_deleted = FALSE
        `, [userId, otherUserId, otherUserId, userId]);

        if (messageCount.count === 0) {
            return res.status(404).json({ error: 'No messages found in this conversation' });
        }

        let deletionMessage = '';

        if (deleteFor === 'everyone') {
            // Delete all messages in the conversation for everyone
            await query(`
                UPDATE messages
                SET is_deleted = TRUE, content = "[Message deleted]"
                WHERE ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))
                  AND room_id IS NULL
                  AND is_deleted = FALSE
            `, [userId, otherUserId, otherUserId, userId]);

            deletionMessage = `All messages deleted from conversation with ${otherUser.display_name}`;

            // Notify the other user
            notifyUserViaSocket(otherUserId, 'conversation_deleted', {
                deletedBy: req.session.username,
                messageCount: messageCount.count
            });

            // Refresh DM messages and conversations for both users
            notifyUserViaSocket(userId, 'refresh_dm_messages', { userId: otherUserId });
            notifyUserViaSocket(otherUserId, 'refresh_dm_messages', { userId: userId });
            notifyUserViaSocket(userId, 'refresh_dm_conversations', {});
            notifyUserViaSocket(otherUserId, 'refresh_dm_conversations', {});

        } else {
            // Delete messages for current user only
            await query(`
                UPDATE messages
                SET is_deleted = TRUE
                WHERE ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))
                  AND room_id IS NULL
                  AND is_deleted = FALSE
            `, [userId, otherUserId, otherUserId, userId]);

            deletionMessage = `Conversation history cleared for you (${messageCount.count} messages)`;

            // Only refresh for current user
            notifyUserViaSocket(userId, 'refresh_dm_messages', { userId: otherUserId });
            notifyUserViaSocket(userId, 'refresh_dm_conversations', {});
        }

        res.json({
            message: deletionMessage,
            deletedCount: messageCount.count
        });

    } catch (error) {
        console.error('Delete DM conversation error:', error);
        res.status(500).json({ error: 'Failed to delete conversation messages' });
    }
});

module.exports = { router, setSocketIO };