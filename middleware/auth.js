// middleware/auth.js - Authentication middleware
const { userQueries } = require('../config/database');

// Middleware to check if user is authenticated
function requireAuth(req, res, next) {
    console.log('Session check:', {
        hasSession: !!req.session,
        userId: req.session?.userId,
        sessionID: req.sessionID
    });

    if (!req.session || !req.session.userId) {
        return res.status(401).json({
            error: 'Authentication required',
            redirect: '/login'
        });
    }
    next();
}

// Middleware to check if user is already authenticated (for login/register pages)
function requireGuest(req, res, next) {
    if (req.session.userId) {
        return res.status(200).json({
            message: 'Already authenticated',
            redirect: '/'
        });
    }
    next();
}

// Middleware to get current user information
async function getCurrentUser(req, res, next) {
    if (req.session.userId) {
        try {
            const user = await userQueries.findById(req.session.userId);
            if (user) {
                req.user = user;
            } else {
                // User not found, clear session
                req.session.destroy();
            }
        } catch (error) {
            console.error('Error fetching current user:', error);
        }
    }
    next();
}

// Middleware to check if user owns a room or is admin
async function requireRoomAccess(req, res, next) {
    try {
        const roomId = req.params.roomId || req.body.roomId;
        const userId = req.session.userId;

        if (!roomId) {
            return res.status(400).json({ error: 'Room ID required' });
        }

        // Check if user is member of the room
        const membership = await userQueries.queryOne(
            'SELECT role FROM room_members WHERE room_id = ? AND user_id = ? AND is_active = TRUE',
            [roomId, userId]
        );

        if (!membership) {
            return res.status(403).json({ error: 'Access denied to this room' });
        }

        req.roomMembership = membership;
        next();
    } catch (error) {
        console.error('Room access check error:', error);
        res.status(500).json({ error: 'Server error' });
    }
}

// Middleware to check if user is room owner or admin
function requireRoomAdmin(req, res, next) {
    if (!req.roomMembership || !['owner', 'admin'].includes(req.roomMembership.role)) {
        return res.status(403).json({ error: 'Admin privileges required' });
    }
    next();
}

// Middleware to validate input data
function validateInput(rules) {
    return (req, res, next) => {
        const errors = [];

        for (const field in rules) {
            const value = req.body[field];
            const rule = rules[field];

            // Check if required field is missing
            if (rule.required && (!value || value.trim() === '')) {
                errors.push(`${field} is required`);
                continue;
            }

            // Skip validation if field is optional and empty
            if (!rule.required && (!value || value.trim() === '')) {
                continue;
            }

            // Length validation
            if (rule.minLength && value.length < rule.minLength) {
                errors.push(`${field} must be at least ${rule.minLength} characters`);
            }
            if (rule.maxLength && value.length > rule.maxLength) {
                errors.push(`${field} must be no more than ${rule.maxLength} characters`);
            }

            // Pattern validation
            if (rule.pattern && !rule.pattern.test(value)) {
                errors.push(`${field} format is invalid`);
            }

            // Custom validation
            if (rule.validate && !rule.validate(value)) {
                errors.push(rule.message || `${field} is invalid`);
            }
        }

        if (errors.length > 0) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors
            });
        }

        next();
    };
}

// Common validation rules
const validationRules = {
    register: {
        username: {
            required: true,
            minLength: 3,
            maxLength: 50,
            pattern: /^[a-zA-Z0-9_]+$/,
            message: 'Username can only contain letters, numbers, and underscores'
        },
        password: {
            required: true,
            minLength: 6,
            maxLength: 100
        },
        display_name: {
            required: true,
            minLength: 1,
            maxLength: 100
        },
        email: {
            required: false,
            pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
            message: 'Email format is invalid'
        }
    },

    login: {
        username: {
            required: true,
            minLength: 3,
            maxLength: 50
        },
        password: {
            required: true,
            minLength: 1
        }
    },

    createRoom: {
        name: {
            required: true,
            minLength: 1,
            maxLength: 100,
            pattern: /^[a-zA-Z0-9_-]+$/,
            message: 'Room name can only contain letters, numbers, hyphens, and underscores'
        },
        display_name: {
            required: true,
            minLength: 1,
            maxLength: 100
        },
        description: {
            required: false,
            maxLength: 500
        }
    },

    sendMessage: {
        content: {
            required: true,
            minLength: 1,
            maxLength: 2000
        }
    }
};

module.exports = {
    requireAuth,
    requireGuest,
    getCurrentUser,
    requireRoomAccess,
    requireRoomAdmin,
    validateInput,
    validationRules
};