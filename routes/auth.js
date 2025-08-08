// routes/auth.js - Authentication routes
const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { userQueries, roomQueries, query, queryOne } = require('../config/database');
const { requireGuest, requireAuth, validateInput, validationRules } = require('../middleware/auth');

const router = express.Router();

// Rate limiting for auth routes
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // limit each IP to 5 requests per windowMs
    message: {
        error: 'Too many authentication attempts, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false
});

// Registration route
router.post('/register', authLimiter, validateInput(validationRules.register), async (req, res) => {
    try {
        const { username, password, display_name, email } = req.body;

        // Check if username already exists
        const existingUser = await userQueries.findByUsername(username);
        if (existingUser) {
            return res.status(409).json({
                error: 'Username already taken',
                field: 'username'
            });
        }

        // Check if email already exists (if provided)
        if (email) {
            const existingEmail = await queryOne(
                'SELECT id FROM users WHERE email = ? AND is_active = TRUE',
                [email]
            );
            if (existingEmail) {
                return res.status(409).json({
                    error: 'Email already registered',
                    field: 'email'
                });
            }
        }

        // Hash password
        const saltRounds = 12;
        const password_hash = await bcrypt.hash(password, saltRounds);

        // Create user
        const userId = await userQueries.create({
            username,
            email: email || null,
            password_hash,
            display_name
        });

        // Add user to main room
        const mainRoom = await queryOne(
            'SELECT id FROM rooms WHERE name = "main" AND is_active = TRUE'
        );

        if (mainRoom) {
            await roomQueries.addMember(mainRoom.id, userId, 'member');
        }

        // Set session
        req.session.userId = userId;
        req.session.username = username;

        // Update user status to online
        await userQueries.updateStatus(userId, 'online');

        console.log(`✅ New user registered: ${username} (ID: ${userId})`);

        res.status(201).json({
            message: 'Registration successful',
            user: {
                id: userId,
                username,
                display_name,
                email: email || null
            }
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            error: 'Registration failed. Please try again.'
        });
    }
});

// Login route
router.post('/login', authLimiter, validateInput(validationRules.login), async (req, res) => {
    try {
        const { username, password } = req.body;

        // Find user
        const user = await userQueries.findByUsername(username);
        if (!user) {
            return res.status(401).json({
                error: 'Invalid username or password'
            });
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
            return res.status(401).json({
                error: 'Invalid username or password'
            });
        }

        // Set session
        req.session.userId = user.id;
        req.session.username = user.username;

        // Update user status to online
        await userQueries.updateStatus(user.id, 'online');

        console.log(`✅ User logged in: ${username} (ID: ${user.id})`);

        res.json({
            message: 'Login successful',
            user: {
                id: user.id,
                username: user.username,
                display_name: user.display_name,
                email: user.email,
                avatar_url: user.avatar_url
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            error: 'Login failed. Please try again.'
        });
    }
});

// Logout route
router.post('/logout', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const username = req.session.username;

        // Update user status to offline
        await userQueries.updateStatus(userId, 'offline');

        // Destroy session
        req.session.destroy((err) => {
            if (err) {
                console.error('Session destruction error:', err);
                return res.status(500).json({ error: 'Logout failed' });
            }

            console.log(`✅ User logged out: ${username} (ID: ${userId})`);
            res.json({ message: 'Logout successful' });
        });

    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({
            error: 'Logout failed. Please try again.'
        });
    }
});

// Check authentication status
router.get('/status', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.json({
                authenticated: false
            });
        }

        const user = await userQueries.findById(req.session.userId);
        if (!user) {
            // User not found, clear session
            req.session.destroy();
            return res.json({
                authenticated: false
            });
        }

        res.json({
            authenticated: true,
            user: {
                id: user.id,
                username: user.username,
                display_name: user.display_name,
                email: user.email,
                avatar_url: user.avatar_url,
                status: user.status
            }
        });

    } catch (error) {
        console.error('Auth status check error:', error);
        res.status(500).json({
            error: 'Failed to check authentication status'
        });
    }
});

// Get current user profile
router.get('/profile', requireAuth, async (req, res) => {
    try {
        const user = await userQueries.findById(req.session.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            user: {
                id: user.id,
                username: user.username,
                display_name: user.display_name,
                email: user.email,
                avatar_url: user.avatar_url,
                status: user.status,
                created_at: user.created_at,
                last_seen: user.last_seen
            }
        });

    } catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).json({
            error: 'Failed to fetch profile'
        });
    }
});

// Update user profile
router.put('/profile', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const { display_name, email, avatar_url } = req.body;

        // Validation
        if (display_name && (display_name.length < 1 || display_name.length > 100)) {
            return res.status(400).json({ error: 'Display name must be 1-100 characters' });
        }

        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        // Check if email is already taken by another user
        if (email) {
            const existingEmail = await queryOne(
                'SELECT id FROM users WHERE email = ? AND id != ? AND is_active = TRUE',
                [email, userId]
            );
            if (existingEmail) {
                return res.status(409).json({ error: 'Email already taken' });
            }
        }

        // Update user
        const updateFields = [];
        const updateValues = [];

        if (display_name !== undefined) {
            updateFields.push('display_name = ?');
            updateValues.push(display_name);
        }
        if (email !== undefined) {
            updateFields.push('email = ?');
            updateValues.push(email);
        }
        if (avatar_url !== undefined) {
            updateFields.push('avatar_url = ?');
            updateValues.push(avatar_url);
        }

        if (updateFields.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        updateValues.push(userId);
        await query(
            `UPDATE users SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            updateValues
        );

        // Fetch updated user
        const updatedUser = await userQueries.findById(userId);

        res.json({
            message: 'Profile updated successfully',
            user: {
                id: updatedUser.id,
                username: updatedUser.username,
                display_name: updatedUser.display_name,
                email: updatedUser.email,
                avatar_url: updatedUser.avatar_url
            }
        });

    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({
            error: 'Failed to update profile'
        });
    }
});

module.exports = router;