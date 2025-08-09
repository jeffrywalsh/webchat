// config/database.js - Database connection configuration with media support
const mysql = require('mysql2/promise');
require('dotenv').config();

// Database configuration
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'chatapp',
    password: process.env.DB_PASSWORD || 'chatapp123',
    database: process.env.DB_NAME || 'web_chat',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4',
    ssl: false,
    // Handle connection timezone
    timezone: '+00:00',
    // Authentication plugin configuration
    authPlugins: {
        mysql_clear_password: () => () => Buffer.alloc(0),
        mysql_native_password: () => () => Buffer.alloc(0)
    }
};

// Create connection pool
const pool = mysql.createPool(dbConfig);

// Test database connection
async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ Database connected successfully');
        console.log(`📊 Connected to: ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
        connection.release();
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        console.error('🔧 Please check your database configuration in .env file');
        return false;
    }
}

// Initialize database connection
testConnection();

// Helper function to execute queries with error handling
async function query(sql, params = []) {
    try {
        const [results] = await pool.execute(sql, params);
        return results;
    } catch (error) {
        console.error('Database query error:', error);
        throw error;
    }
}

// Helper function to get a single row
async function queryOne(sql, params = []) {
    try {
        const [results] = await pool.execute(sql, params);
        return results[0] || null;
    } catch (error) {
        console.error('Database query error:', error);
        throw error;
    }
}

// Helper function for transactions
async function transaction(callback) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const result = await callback(connection);
        await connection.commit();
        return result;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

// Close connection pool
function end() {
    return pool.end();
}

// User-related database functions
const userQueries = {
    // Find user by username
    async findByUsername(username) {
        return await queryOne(
            'SELECT * FROM users WHERE username = ? AND is_active = TRUE',
            [username]
        );
    },

    // Find user by ID
    async findById(id) {
        return await queryOne(
            'SELECT id, username, email, display_name, avatar_url, status, last_seen, created_at FROM users WHERE id = ? AND is_active = TRUE',
            [id]
        );
    },

    // Create new user
    async create(userData) {
        const { username, email, password_hash, display_name } = userData;
        const result = await query(
            'INSERT INTO users (username, email, password_hash, display_name) VALUES (?, ?, ?, ?)',
            [username, email, password_hash, display_name]
        );
        return result.insertId;
    },

    // Update user status
    async updateStatus(userId, status) {
        return await query(
            'UPDATE users SET status = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?',
            [status, userId]
        );
    },

    // Get all active users (for user list)
    async getActiveUsers() {
        return await query(
            'SELECT id, username, display_name, avatar_url, status FROM users WHERE is_active = TRUE ORDER BY display_name'
        );
    }
};

// Room-related database functions
const roomQueries = {
    // Get all public rooms
    async getPublicRooms() {
        return await query(
            'SELECT r.*, u.display_name as creator_name FROM rooms r JOIN users u ON r.created_by = u.id WHERE r.is_active = TRUE AND r.is_private = FALSE ORDER BY r.name'
        );
    },

    // Get user's rooms
    async getUserRooms(userId) {
        return await query(
            `SELECT r.*, rm.role, rm.last_read_message_id
             FROM rooms r
                      JOIN room_members rm ON r.id = rm.room_id
             WHERE rm.user_id = ? AND r.is_active = TRUE AND rm.is_active = TRUE
             ORDER BY r.name`,
            [userId]
        );
    },

    // Create new room
    async create(roomData) {
        const { name, display_name, description, created_by, is_private } = roomData;
        const result = await query(
            'INSERT INTO rooms (name, display_name, description, created_by, is_private) VALUES (?, ?, ?, ?, ?)',
            [name, display_name, description, created_by, is_private]
        );
        return result.insertId;
    },

    // Add user to room
    async addMember(roomId, userId, role = 'member') {
        return await query(
            'INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE is_active = TRUE, role = ?',
            [roomId, userId, role, role]
        );
    }
};

// Message-related database functions with media support
const messageQueries = {
    // Get room messages with pagination
    async getRoomMessages(roomId, limit = 50, offset = 0) {
        return await query(
            `SELECT m.*, u.username, u.display_name, u.avatar_url
             FROM messages m
                      JOIN users u ON m.sender_id = u.id
             WHERE m.room_id = ? AND m.is_deleted = FALSE
             ORDER BY m.created_at DESC
                 LIMIT ? OFFSET ?`,
            [roomId, limit, offset]
        );
    },

    // Get DM messages
    async getDMMessages(userId1, userId2, limit = 50, offset = 0) {
        return await query(
            `SELECT m.*, u.username, u.display_name, u.avatar_url
             FROM messages m
                      JOIN users u ON m.sender_id = u.id
             WHERE ((m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?))
               AND m.is_deleted = FALSE
             ORDER BY m.created_at DESC
                 LIMIT ? OFFSET ?`,
            [userId1, userId2, userId2, userId1, limit, offset]
        );
    },

    // Create new message with media support
    async create(messageData) {
        const {
            sender_id,
            room_id,
            recipient_id,
            message_type,
            content,
            file_url,
            file_name,
            file_size,
            link_title,
            link_description,
            link_image
        } = messageData;

        const result = await query(
            `INSERT INTO messages (
                sender_id,
                room_id,
                recipient_id,
                message_type,
                content,
                file_url,
                file_name,
                file_size,
                link_title,
                link_description,
                link_image
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                sender_id,
                room_id,
                recipient_id,
                message_type,
                content,
                file_url,
                file_name,
                file_size,
                link_title,
                link_description,
                link_image
            ]
        );
        return result.insertId;
    }
};

// Friend-related database functions
const friendQueries = {
    // Get user's friends
    async getFriends(userId) {
        return await query(`
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
        `, [userId, userId, userId, userId, userId, userId]);
    },

    // Check friendship status
    async getFriendshipStatus(userId, targetUserId) {
        return await queryOne(`
            SELECT id, status, requester_id, addressee_id
            FROM friends
            WHERE (requester_id = ? AND addressee_id = ?)
               OR (requester_id = ? AND addressee_id = ?)
        `, [userId, targetUserId, targetUserId, userId]);
    },

    // Get pending friend requests
    async getPendingRequests(userId) {
        return await query(`
            SELECT
                f.id as friendship_id,
                f.created_at,
                u.id as user_id,
                u.username,
                u.display_name,
                u.avatar_url
            FROM friends f
                     JOIN users u ON f.requester_id = u.id
            WHERE f.addressee_id = ?
              AND f.status = 'pending'
              AND u.is_active = TRUE
            ORDER BY f.created_at DESC
        `, [userId]);
    }
};

// Enhanced conversation queries
const conversationQueries = {
    // Get user's DM conversations (respecting hidden/deleted status)
    async getUserConversations(userId) {
        return await query(`
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
                (dc.user1_id = ? AND (dc.user1_hidden = FALSE OR dc.user1_hidden IS NULL) AND dc.user1_deleted_at IS NULL) OR
                (dc.user2_id = ? AND (dc.user2_hidden = FALSE OR dc.user2_hidden IS NULL) AND dc.user2_deleted_at IS NULL)
                )
            ORDER BY dc.last_message_at DESC
        `, [userId, userId, userId, userId, userId, userId, userId, userId, userId]);
    },

    // Create or get DM conversation
    async createOrGetConversation(user1Id, user2Id) {
        const userId1 = Math.min(user1Id, user2Id);
        const userId2 = Math.max(user1Id, user2Id);

        let conversation = await queryOne(
            'SELECT id FROM dm_conversations WHERE user1_id = ? AND user2_id = ? AND is_active = TRUE',
            [userId1, userId2]
        );

        if (!conversation) {
            const result = await query(
                'INSERT INTO dm_conversations (user1_id, user2_id) VALUES (?, ?)',
                [userId1, userId2]
            );
            conversation = { id: result.insertId };
        }

        return conversation;
    }
};

module.exports = {
    pool,
    query,
    queryOne,
    transaction,
    end,
    userQueries,
    roomQueries,
    messageQueries,
    friendQueries,
    conversationQueries
};