// routes/messages.js - Message handling routes
const express = require('express');
const { messageQueries, queryOne } = require('../config/database');

const router = express.Router();

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

module.exports = router;