
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Initialize SQLite database
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'chat.db');

// Create directory if it doesn't exist
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  console.log(`Creating database directory: ${dbDir}`);
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath, { verbose: console.log });

// Ensure messages table has replyToType column
try {
  const hasReplyToTypeColumn = db.prepare(`PRAGMA table_info(messages);`).all().some(col => col.name === 'replyToType');
  if (!hasReplyToTypeColumn) {
    console.log('Migrating messages table to add replyToType column');
    db.prepare(`ALTER TABLE messages RENAME TO messages_old;`).run();
    db.prepare(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender TEXT,
        receiver TEXT,
        content TEXT,
        type TEXT,
        time TEXT,
        seen INTEGER,
        replyTo TEXT,
        replyToType TEXT
      )
    `).run();
    db.prepare(`
      INSERT INTO messages (id, sender, receiver, content, type, time, seen, replyTo)
      SELECT id, sender, receiver, content, type, time, seen, replyTo
      FROM messages_old;
    `).run();
    db.prepare(`DROP TABLE messages_old;`).run();
    console.log('Messages table migration completed');
  }
} catch (error) {
  console.error('Error migrating messages table:', error);
  // Fallback: Drop and recreate messages table
  db.prepare(`DROP TABLE IF EXISTS messages;`).run();
  db.prepare(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender TEXT,
      receiver TEXT,
      content TEXT,
      type TEXT,
      time TEXT,
      seen INTEGER,
      replyTo TEXT,
      replyToType TEXT
    )
  `).run();
  console.log('Created new messages table due to migration failure');
}

// Initialize stickers table
try {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS stickers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT,
      uploader TEXT,
      type TEXT,
      created_at TEXT
    )
  `).run();
  console.log('Stickers table initialized');
} catch (error) {
  console.error('Error creating stickers table:', error);
}

// Insert a new message
function insertMessage(sender, receiver, content, type = 'text', replyTo = null, replyToType = null) {
  try {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const stmt = db.prepare(`
      INSERT INTO messages (sender, receiver, content, type, time, seen, replyTo, replyToType)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(sender, receiver, content, type, time, 0, replyTo || null, replyToType || null);
    console.log(`Inserted message ID: ${result.lastInsertRowid} from ${sender} to ${receiver}`);
    return result.lastInsertRowid;
  } catch (error) {
    console.error('Error inserting message:', error);
    throw error;
  }
}

// Fetch conversation between two users
function fetchConversation(sender, receiver, callback) {
  try {
    const stmt = db.prepare(`
      SELECT id, sender, receiver, content, type, time, seen, replyTo, replyToType
      FROM messages WHERE 
      (sender = ? AND receiver = ?) OR 
      (sender = ? AND receiver = ?)
      ORDER BY id ASC
    `);
    const messages = stmt.all(sender, receiver, receiver, sender);
    console.log(`Fetched ${messages.length} messages between ${sender} and ${receiver}`);
    callback(messages);
  } catch (error) {
    console.error('Error fetching conversation:', error);
    callback([]);
  }
}

// Mark messages as seen
function markMessagesAsSeen(sender, receiver) {
  try {
    const stmt = db.prepare(`
      UPDATE messages SET seen = 1 WHERE sender = ? AND receiver = ? AND seen = 0
    `);
    const result = stmt.run(sender, receiver);
    console.log(`Marked ${result.changes} messages as seen from ${sender} to ${receiver}`);
    return result.changes;
  } catch (error) {
    console.error('Error marking messages as seen:', error);
    throw error;
  }
}

// Delete a message by ID
function deleteMessageById(id) {
  try {
    const stmt = db.prepare(`DELETE FROM messages WHERE id = ?`);
    const result = stmt.run(id);
    if (result.changes === 0) {
      console.warn(`No message found with ID ${id}`);
    } else {
      console.log(`Deleted message ID: ${id}`);
    }
    return result.changes; // Returns number of rows affected
  } catch (error) {
    console.error('Error deleting message:', error);
    throw error;
  }
}

// Update a message by ID
function updateMessageById(id, newContent) {
  try {
    const stmt = db.prepare(`UPDATE messages SET content = ? WHERE id = ?`);
    const result = stmt.run(newContent + " (edited)", id);
    if (result.changes === 0) {
      console.warn(`No message found with ID ${id} for update`);
    } else {
      console.log(`Updated message ID: ${id}`);
    }
    return result.changes;
  } catch (error) {
    console.error('Error updating message:', error);
    throw error;
  }
}

// Insert a new sticker
function insertSticker(url, uploader, type) {
  try {
    const created_at = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const stmt = db.prepare(`
      INSERT INTO stickers (url, uploader, type, created_at)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(url, uploader, type, created_at);
    console.log(`Inserted sticker ID: ${result.lastInsertRowid} by ${uploader}`);
    return result.lastInsertRowid;
  } catch (error) {
    console.error('Error inserting sticker:', error);
    throw error;
  }
}

// Fetch all stickers
function fetchAllStickers() {
  try {
    const stmt = db.prepare(`SELECT * FROM stickers ORDER BY id DESC`);
    const stickers = stmt.all();
    console.log(`Fetched ${stickers.length} stickers`);
    return stickers;
  } catch (error) {
    console.error('Error fetching stickers:', error);
    return [];
  }
}

// Delete a sticker by ID
function deleteStickerById(id) {
  try {
    const stmt = db.prepare(`DELETE FROM stickers WHERE id = ?`);
    const result = stmt.run(id);
    if (result.changes === 0) {
      console.warn(`No sticker found with ID ${id}`);
    } else {
      console.log(`Deleted sticker ID: ${id}`);
    }
    return result.changes; // Returns number of rows affected
  } catch (error) {
    console.error('Error deleting sticker:', error);
    throw error;
  }
}

module.exports = {
  insertMessage,
  fetchConversation,
  markMessagesAsSeen,
  deleteMessageById,
  updateMessageById,
  insertSticker,
  fetchAllStickers,
  deleteStickerById
};
