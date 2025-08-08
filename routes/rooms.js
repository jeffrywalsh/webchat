// routes/rooms.js - Enhanced room management routes
const express = require('express');
const { roomQueries, query, queryOne } = require('../config/database');
const { validateInput, validationRules } = require('../middleware/auth');

const router = express.Router();

// Get user's rooms
router.get('/', async (req, res) => {
    try {
        const userId = req.session.userId;
        const rooms = await roomQueries.getUserRooms(userId);

        res.json({ rooms });
    } catch (error) {
        console.error('Get rooms error:', error);
        res.status(500).json({ error: 'Failed to fetch rooms' });
    }
});

// Get public rooms with user counts - NEW ENDPOINT
router.get('/browse', async (req, res) => {
    try {
        const userId = req.session.userId;

        // Get public rooms with member counts and user's membership status
        const rooms = await query(`
            SELECT
                r.*,
                u.display_name as creator_name,
                COUNT(DISTINCT rm.user_id) as member_count,
                CASE WHEN urm.user_id IS NOT NULL THEN 1 ELSE 0 END as is_member
            FROM rooms r
                     JOIN users u ON r.created_by = u.id
                     LEFT JOIN room_members rm ON r.id = rm.room_id AND rm.is_active = TRUE
                     LEFT JOIN room_members urm ON r.id = urm.room_id AND urm.user_id = ? AND urm.is_active = TRUE
            WHERE r.is_active = TRUE AND r.is_private = FALSE
            GROUP BY r.id
            ORDER BY member_count DESC, r.name
        `, [userId]);

        res.json({ rooms });
    } catch (error) {
        console.error('Browse rooms error:', error);
        res.status(500).json({ error: 'Failed to fetch public rooms' });
    }
});

// Get public rooms (original endpoint)
router.get('/public', async (req, res) => {
    try {
        const rooms = await roomQueries.getPublicRooms();
        res.json({ rooms });
    } catch (error) {
        console.error('Get public rooms error:', error);
        res.status(500).json({ error: 'Failed to fetch public rooms' });
    }
});

// Create new room
router.post('/', validateInput(validationRules.createRoom), async (req, res) => {
    try {
        const { name, display_name, description, is_private } = req.body;
        const userId = req.session.userId;

        // Check if room name already exists
        const existingRoom = await queryOne(
            'SELECT id FROM rooms WHERE name = ? AND is_active = TRUE',
            [name]
        );

        if (existingRoom) {
            return res.status(409).json({
                error: 'Room name already exists',
                field: 'name'
            });
        }

        // Create room
        const roomId = await roomQueries.create({
            name,
            display_name,
            description,
            created_by: userId,
            is_private: is_private || false
        });

        // Add creator as owner
        await roomQueries.addMember(roomId, userId, 'owner');

        res.status(201).json({
            message: 'Room created successfully',
            room: {
                id: roomId,
                name,
                display_name,
                description,
                is_private: is_private || false
            }
        });

    } catch (error) {
        console.error('Create room error:', error);
        res.status(500).json({ error: 'Failed to create room' });
    }
});

// Join room - ENHANCED
router.post('/:roomId/join', async (req, res) => {
    try {
        const { roomId } = req.params;
        const userId = req.session.userId;

        // Check if room exists and is public
        const room = await queryOne(
            'SELECT * FROM rooms WHERE id = ? AND is_active = TRUE',
            [roomId]
        );

        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        if (room.is_private) {
            return res.status(403).json({ error: 'Cannot join private room without invitation' });
        }

        // Check if user is already a member
        const existingMembership = await queryOne(
            'SELECT * FROM room_members WHERE room_id = ? AND user_id = ?',
            [roomId, userId]
        );

        if (existingMembership) {
            if (existingMembership.is_active) {
                return res.status(409).json({ error: 'Already a member of this room' });
            } else {
                // Reactivate membership
                await query(
                    'UPDATE room_members SET is_active = TRUE WHERE room_id = ? AND user_id = ?',
                    [roomId, userId]
                );
            }
        } else {
            // Add user to room
            await roomQueries.addMember(roomId, userId, 'member');
        }

        res.json({
            message: 'Joined room successfully',
            room: {
                id: room.id,
                name: room.name,
                display_name: room.display_name,
                description: room.description
            }
        });

    } catch (error) {
        console.error('Join room error:', error);
        res.status(500).json({ error: 'Failed to join room' });
    }
});

// Leave room - ENHANCED WITH AUTO-DELETION
router.post('/:roomId/leave', async (req, res) => {
    try {
        const { roomId } = req.params;
        const userId = req.session.userId;

        // Check if user is in room
        const membership = await queryOne(
            'SELECT * FROM room_members WHERE room_id = ? AND user_id = ? AND is_active = TRUE',
            [roomId, userId]
        );

        if (!membership) {
            return res.status(404).json({ error: 'You are not a member of this room' });
        }

        // Get room info for response and check if it's the main room
        const room = await queryOne(
            'SELECT name, display_name FROM rooms WHERE id = ? AND is_active = TRUE',
            [roomId]
        );

        // Can't leave the main room
        if (room?.name === 'main') {
            return res.status(403).json({
                error: 'Cannot leave the main channel'
            });
        }

        // Can't leave if you're the owner and there are other members
        if (membership.role === 'owner') {
            const otherMembers = await queryOne(
                'SELECT COUNT(*) as count FROM room_members WHERE room_id = ? AND user_id != ? AND is_active = TRUE',
                [roomId, userId]
            );

            if (otherMembers.count > 0) {
                return res.status(403).json({
                    error: 'Room owners cannot leave while other members are present. Transfer ownership first.'
                });
            }
        }

        // Remove from room (deactivate membership)
        await query(
            'UPDATE room_members SET is_active = FALSE WHERE room_id = ? AND user_id = ?',
            [roomId, userId]
        );

        // Check if room is now empty (no active members)
        const remainingMembers = await queryOne(
            'SELECT COUNT(*) as count FROM room_members WHERE room_id = ? AND is_active = TRUE',
            [roomId]
        );

        let roomDeleted = false;
        if (remainingMembers.count === 0 && room?.name !== 'main') {
            // Delete empty room (except main)
            await query('UPDATE rooms SET is_active = FALSE WHERE id = ?', [roomId]);
            roomDeleted = true;
            console.log(`🗑️ Auto-deleted empty room: ${room.display_name} (ID: ${roomId})`);
        }

        const message = roomDeleted ?
            `Left ${room?.display_name} - Channel deleted (was empty)` :
            'Left room successfully';

        res.json({
            message,
            room: {
                id: roomId,
                name: room?.name,
                display_name: room?.display_name,
                deleted: roomDeleted
            }
        });

    } catch (error) {
        console.error('Leave room error:', error);
        res.status(500).json({ error: 'Failed to leave room' });
    }
});

// Get room details
router.get('/:roomId', async (req, res) => {
    try {
        const { roomId } = req.params;
        const userId = req.session.userId;

        // Check if user has access to room
        const membership = await queryOne(
            'SELECT role FROM room_members WHERE room_id = ? AND user_id = ? AND is_active = TRUE',
            [roomId, userId]
        );

        if (!membership) {
            return res.status(403).json({ error: 'Access denied to this room' });
        }

        // Get room details with member count
        const room = await queryOne(`
            SELECT
                r.*,
                u.display_name as creator_name,
                COUNT(DISTINCT rm.user_id) as member_count
            FROM rooms r
                     JOIN users u ON r.created_by = u.id
                     LEFT JOIN room_members rm ON r.id = rm.room_id AND rm.is_active = TRUE
            WHERE r.id = ? AND r.is_active = TRUE
            GROUP BY r.id
        `, [roomId]);

        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        res.json({
            room: {
                ...room,
                user_role: membership.role
            }
        });

    } catch (error) {
        console.error('Get room details error:', error);
        res.status(500).json({ error: 'Failed to fetch room details' });
    }
});

module.exports = router;