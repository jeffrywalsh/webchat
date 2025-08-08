// routes/friends.js - Friend management routes
const express = require('express');
const { query, queryOne } = require('../config/database');

const router = express.Router();

// Get user's friends list
router.get('/', async (req, res) => {
    try {
        const userId = req.session.userId;

        // Get accepted friends with their info and online status
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

        res.json({ friends });
    } catch (error) {
        console.error('Get friends error:', error);
        res.status(500).json({ error: 'Failed to fetch friends' });
    }
});

// Get pending friend requests (received)
router.get('/requests', async (req, res) => {
    try {
        const userId = req.session.userId;

        const requests = await query(`
            SELECT
                f.id as friendship_id,
                f.created_at,
                u.id as user_id,
                u.username,
                u.display_name,
                u.avatar_url,
                u.status
            FROM friends f
                     JOIN users u ON f.requester_id = u.id
            WHERE f.addressee_id = ?
              AND f.status = 'pending'
              AND u.is_active = TRUE
            ORDER BY f.created_at DESC
        `, [userId]);

        res.json({ requests });
    } catch (error) {
        console.error('Get friend requests error:', error);
        res.status(500).json({ error: 'Failed to fetch friend requests' });
    }
});

// Get sent friend requests
router.get('/sent', async (req, res) => {
    try {
        const userId = req.session.userId;

        const sentRequests = await query(`
            SELECT
                f.id as friendship_id,
                f.created_at,
                f.status,
                u.id as user_id,
                u.username,
                u.display_name,
                u.avatar_url
            FROM friends f
                     JOIN users u ON f.addressee_id = u.id
            WHERE f.requester_id = ?
              AND f.status IN ('pending', 'rejected')
              AND u.is_active = TRUE
            ORDER BY f.created_at DESC
        `, [userId]);

        res.json({ sentRequests });
    } catch (error) {
        console.error('Get sent requests error:', error);
        res.status(500).json({ error: 'Failed to fetch sent requests' });
    }
});

// Send friend request
router.post('/request/:userId', async (req, res) => {
    try {
        const userId = req.session.userId;
        const targetUserId = parseInt(req.params.userId);

        if (userId === targetUserId) {
            return res.status(400).json({ error: 'Cannot send friend request to yourself' });
        }

        // Check if target user exists
        const targetUser = await queryOne(
            'SELECT id, username, display_name FROM users WHERE id = ? AND is_active = TRUE',
            [targetUserId]
        );

        if (!targetUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Check if friendship already exists
        const existingFriendship = await queryOne(`
            SELECT id, status FROM friends
            WHERE (requester_id = ? AND addressee_id = ?)
               OR (requester_id = ? AND addressee_id = ?)
        `, [userId, targetUserId, targetUserId, userId]);

        if (existingFriendship) {
            switch (existingFriendship.status) {
                case 'accepted':
                    return res.status(409).json({ error: 'Already friends' });
                case 'pending':
                    return res.status(409).json({ error: 'Friend request already pending' });
                case 'blocked':
                    return res.status(403).json({ error: 'Cannot send friend request' });
                case 'rejected':
                    // Update existing rejected request to pending
                    await query(
                        'UPDATE friends SET status = "pending", updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                        [existingFriendship.id]
                    );
                    break;
            }
        } else {
            // Create new friend request
            await query(
                'INSERT INTO friends (requester_id, addressee_id, status) VALUES (?, ?, "pending")',
                [userId, targetUserId]
            );
        }

        res.json({
            message: `Friend request sent to ${targetUser.display_name}`,
            user: targetUser
        });

    } catch (error) {
        console.error('Send friend request error:', error);
        res.status(500).json({ error: 'Failed to send friend request' });
    }
});

// Accept friend request
router.put('/accept/:friendshipId', async (req, res) => {
    try {
        const userId = req.session.userId;
        const friendshipId = parseInt(req.params.friendshipId);

        // Check if this is a valid pending request for this user
        const friendship = await queryOne(`
            SELECT f.*, u.username, u.display_name
            FROM friends f
                     JOIN users u ON f.requester_id = u.id
            WHERE f.id = ? AND f.addressee_id = ? AND f.status = 'pending'
        `, [friendshipId, userId]);

        if (!friendship) {
            return res.status(404).json({ error: 'Friend request not found' });
        }

        // Accept the friend request
        await query(
            'UPDATE friends SET status = "accepted", updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [friendshipId]
        );

        res.json({
            message: `You are now friends with ${friendship.display_name}`,
            friendship: {
                id: friendship.id,
                friend_id: friendship.requester_id,
                username: friendship.username,
                display_name: friendship.display_name
            }
        });

    } catch (error) {
        console.error('Accept friend request error:', error);
        res.status(500).json({ error: 'Failed to accept friend request' });
    }
});

// Reject friend request
router.put('/reject/:friendshipId', async (req, res) => {
    try {
        const userId = req.session.userId;
        const friendshipId = parseInt(req.params.friendshipId);

        // Check if this is a valid pending request for this user
        const friendship = await queryOne(`
            SELECT f.*, u.username, u.display_name
            FROM friends f
                     JOIN users u ON f.requester_id = u.id
            WHERE f.id = ? AND f.addressee_id = ? AND f.status = 'pending'
        `, [friendshipId, userId]);

        if (!friendship) {
            return res.status(404).json({ error: 'Friend request not found' });
        }

        // Reject the friend request
        await query(
            'UPDATE friends SET status = "rejected", updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [friendshipId]
        );

        res.json({
            message: `Friend request from ${friendship.display_name} rejected`
        });

    } catch (error) {
        console.error('Reject friend request error:', error);
        res.status(500).json({ error: 'Failed to reject friend request' });
    }
});

// Remove friend / Cancel request
router.delete('/:friendshipId', async (req, res) => {
    try {
        const userId = req.session.userId;
        const friendshipId = parseInt(req.params.friendshipId);

        // Check if this friendship involves the current user
        const friendship = await queryOne(`
            SELECT f.*,
                   u1.display_name as requester_name,
                   u2.display_name as addressee_name
            FROM friends f
                     JOIN users u1 ON f.requester_id = u1.id
                     JOIN users u2 ON f.addressee_id = u2.id
            WHERE f.id = ?
              AND (f.requester_id = ? OR f.addressee_id = ?)
        `, [friendshipId, userId, userId]);

        if (!friendship) {
            return res.status(404).json({ error: 'Friendship not found' });
        }

        // Delete the friendship
        await query('DELETE FROM friends WHERE id = ?', [friendshipId]);

        const friendName = friendship.requester_id === userId ?
            friendship.addressee_name : friendship.requester_name;

        const actionMessage = friendship.status === 'pending' ?
            'Friend request cancelled' : `Removed ${friendName} from friends`;

        res.json({ message: actionMessage });

    } catch (error) {
        console.error('Remove friend error:', error);
        res.status(500).json({ error: 'Failed to remove friend' });
    }
});

// Check friendship status with a user
router.get('/status/:userId', async (req, res) => {
    try {
        const userId = req.session.userId;
        const targetUserId = parseInt(req.params.userId);

        if (userId === targetUserId) {
            return res.json({ status: 'self' });
        }

        const friendship = await queryOne(`
            SELECT id, status, requester_id, addressee_id
            FROM friends
            WHERE (requester_id = ? AND addressee_id = ?)
               OR (requester_id = ? AND addressee_id = ?)
        `, [userId, targetUserId, targetUserId, userId]);

        if (!friendship) {
            return res.json({ status: 'none' });
        }

        // Determine the perspective
        let perspective = 'none';
        if (friendship.status === 'accepted') {
            perspective = 'friends';
        } else if (friendship.status === 'pending') {
            if (friendship.requester_id === userId) {
                perspective = 'sent_request';
            } else {
                perspective = 'received_request';
            }
        } else if (friendship.status === 'rejected') {
            perspective = 'rejected';
        } else if (friendship.status === 'blocked') {
            perspective = 'blocked';
        }

        res.json({
            status: perspective,
            friendship_id: friendship.id
        });

    } catch (error) {
        console.error('Check friendship status error:', error);
        res.status(500).json({ error: 'Failed to check friendship status' });
    }
});

module.exports = router;