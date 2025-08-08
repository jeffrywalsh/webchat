// routes/conversations.js - DM conversation management routes
const express = require('express');
const { query, queryOne } = require('../config/database');

const router = express.Router();

// Get user's DM conversations (updated to respect hidden/deleted status)
router.get('/', async (req, res) => {
    try {
        const userId = req.session.userId;

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
        `, [userId, userId, userId, userId, userId, userId, userId, userId, userId]);

        const formattedConversations = conversations.map(conv => ({
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

        res.json({ conversations: formattedConversations });
    } catch (error) {
        console.error('Get conversations error:', error);
        res.status(500).json({ error: 'Failed to fetch conversations' });
    }
});

// Hide conversation (close but don't delete)
router.put('/:conversationId/hide', async (req, res) => {
    try {
        const userId = req.session.userId;
        const conversationId = parseInt(req.params.conversationId);

        // Check if user is part of this conversation
        const conversation = await queryOne(`
            SELECT user1_id, user2_id, user1_hidden, user2_hidden
            FROM dm_conversations
            WHERE id = ? AND (user1_id = ? OR user2_id = ?) AND is_active = TRUE
        `, [conversationId, userId, userId]);

        if (!conversation) {
            return res.status(404).json({ error: 'Conversation not found' });
        }

        // Determine which user column to update
        const isUser1 = conversation.user1_id === userId;
        const hiddenColumn = isUser1 ? 'user1_hidden' : 'user2_hidden';

        // Hide the conversation for this user
        await query(
            `UPDATE dm_conversations SET ${hiddenColumn} = TRUE WHERE id = ?`,
            [conversationId]
        );

        res.json({ message: 'Conversation hidden' });

    } catch (error) {
        console.error('Hide conversation error:', error);
        res.status(500).json({ error: 'Failed to hide conversation' });
    }
});

// Unhide conversation (reopen)
router.put('/:conversationId/unhide', async (req, res) => {
    try {
        const userId = req.session.userId;
        const conversationId = parseInt(req.params.conversationId);

        // Check if user is part of this conversation
        const conversation = await queryOne(`
            SELECT user1_id, user2_id
            FROM dm_conversations
            WHERE id = ? AND (user1_id = ? OR user2_id = ?) AND is_active = TRUE
        `, [conversationId, userId, userId]);

        if (!conversation) {
            return res.status(404).json({ error: 'Conversation not found' });
        }

        // Determine which user column to update
        const isUser1 = conversation.user1_id === userId;
        const hiddenColumn = isUser1 ? 'user1_hidden' : 'user2_hidden';

        // Unhide the conversation for this user
        await query(
            `UPDATE dm_conversations SET ${hiddenColumn} = FALSE WHERE id = ?`,
            [conversationId]
        );

        res.json({ message: 'Conversation restored' });

    } catch (error) {
        console.error('Unhide conversation error:', error);
        res.status(500).json({ error: 'Failed to restore conversation' });
    }
});

// Delete conversation for user
router.delete('/:conversationId', async (req, res) => {
    try {
        const userId = req.session.userId;
        const conversationId = parseInt(req.params.conversationId);

        // Check if user is part of this conversation
        const conversation = await queryOne(`
            SELECT user1_id, user2_id, user1_deleted_at, user2_deleted_at
            FROM dm_conversations
            WHERE id = ? AND (user1_id = ? OR user2_id = ?) AND is_active = TRUE
        `, [conversationId, userId, userId]);

        if (!conversation) {
            return res.status(404).json({ error: 'Conversation not found' });
        }

        // Determine which user is deleting
        const isUser1 = conversation.user1_id === userId;
        const deletedColumn = isUser1 ? 'user1_deleted_at' : 'user2_deleted_at';
        const otherUserDeleted = isUser1 ? conversation.user2_deleted_at : conversation.user1_deleted_at;

        // Mark as deleted for this user
        await query(
            `UPDATE dm_conversations SET ${deletedColumn} = CURRENT_TIMESTAMP WHERE id = ?`,
            [conversationId]
        );

        // If both users have deleted, mark conversation as inactive
        if (otherUserDeleted) {
            await query(
                'UPDATE dm_conversations SET is_active = FALSE WHERE id = ?',
                [conversationId]
            );

            // Also delete all messages in this conversation
            await query(
                'UPDATE messages SET is_deleted = TRUE WHERE sender_id IN (?, ?) AND recipient_id IN (?, ?)',
                [conversation.user1_id, conversation.user2_id, conversation.user1_id, conversation.user2_id]
            );
        }

        const message = otherUserDeleted ?
            'Conversation deleted permanently' :
            'Conversation deleted for you';

        res.json({ message });

    } catch (error) {
        console.error('Delete conversation error:', error);
        res.status(500).json({ error: 'Failed to delete conversation' });
    }
});

// Get conversation details
router.get('/:conversationId', async (req, res) => {
    try {
        const userId = req.session.userId;
        const conversationId = parseInt(req.params.conversationId);

        // Check if user has access to this conversation
        const conversation = await queryOne(`
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
                    WHEN dc.user1_id = ? THEN dc.user1_hidden
                    ELSE dc.user2_hidden
                    END as is_hidden,
                CASE
                    WHEN dc.user1_id = ? THEN dc.user1_deleted_at
                    ELSE dc.user2_deleted_at
                    END as deleted_at
            FROM dm_conversations dc
                     JOIN users u1 ON dc.user1_id = u1.id
                     JOIN users u2 ON dc.user2_id = u2.id
            WHERE dc.id = ?
              AND (dc.user1_id = ? OR dc.user2_id = ?)
              AND dc.is_active = TRUE
        `, [userId, userId, userId, userId, userId, conversationId, userId, userId]);

        if (!conversation) {
            return res.status(404).json({ error: 'Conversation not found' });
        }

        if (conversation.deleted_at) {
            return res.status(404).json({ error: 'Conversation has been deleted' });
        }

        res.json({
            conversation: {
                id: conversation.id,
                created_at: conversation.created_at,
                last_message_at: conversation.last_message_at,
                is_hidden: !!conversation.is_hidden,
                other_user: {
                    id: conversation.other_user_id,
                    username: conversation.other_username,
                    display_name: conversation.other_display_name
                }
            }
        });

    } catch (error) {
        console.error('Get conversation details error:', error);
        res.status(500).json({ error: 'Failed to fetch conversation details' });
    }
});

module.exports = router;