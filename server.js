const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
require('dotenv').config();

const app = express();

// --- MIDDLEWARE ---
app.use(cors()); 
app.use(express.json());

// --- DATABASE CONNECTION (Aiven) ---
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  ssl: {
    rejectUnauthorized: false 
  }
});

db.connect(err => {
  if (err) {
    console.error('Database connection failed:', err);
    return;
  }
  console.log('Connected to Aiven Cloud MySQL Database!');

  // Auto-create tables if they don't exist
  db.query(`CREATE TABLE IF NOT EXISTS resort_bookings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    guest_name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL
  )`);

  db.query(`CREATE TABLE IF NOT EXISTS pool_bookings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    guest_name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    booking_date DATE NOT NULL
  )`);
});

// --- TELEGRAM HELPER FUNCTION ---
const notifyOwnerTelegram = async (messageText) => {
  try {
    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: messageText,
        parse_mode: 'Markdown' // Allows formatting like *bold*
      })
    });

    if (response.ok) {
      console.log('✅ Telegram notification sent!');
    } else {
      const data = await response.json();
      console.error('❌ Telegram API Error:', data.description);
    }
  } catch (error) {
    console.error('❌ Failed to send Telegram message:', error);
  }
};

// --- API ROUTES ---

// 1. Get Monthly Stats
app.get('/api/stats', (req, res) => {
  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();

  const resortQuery = `SELECT COUNT(*) as count FROM resort_bookings WHERE MONTH(start_date) = ? AND YEAR(start_date) = ?`;
  const poolQuery = `SELECT COUNT(*) as count FROM pool_bookings WHERE MONTH(booking_date) = ? AND YEAR(booking_date) = ?`;

  db.query(resortQuery, [currentMonth, currentYear], (err, resortResults) => {
    if (err) return res.status(500).json({ error: err.message });
    
    db.query(poolQuery, [currentMonth, currentYear], (err, poolResults) => {
      if (err) return res.status(500).json({ error: err.message });
      
      res.json({
        currentMonthResortBookings: resortResults[0].count,
        currentMonthPoolBookings: poolResults[0].count
      });
    });
  });
});

// 2. Get All Bookings (For Calendar View)
app.get('/api/bookings', (req, res) => {
  db.query('SELECT * FROM resort_bookings', (err, resorts) => {
    if (err) return res.status(500).json({ error: err.message });
    
    db.query('SELECT * FROM pool_bookings', (err, pools) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ resorts, pools });
    });
  });
});

// 3. Book Resort (Total Mutual Exclusivity + Telegram)
app.post('/api/book/resort', (req, res) => {
  const { name, phone, startDate, endDate } = req.body;

  // Check 1: Does this overlap with another Resort booking?
  const checkResortSql = `SELECT id FROM resort_bookings WHERE (DATE(?) <= DATE(end_date)) AND (DATE(?) >= DATE(start_date))`;
  
  db.query(checkResortSql, [startDate, endDate], (err, resortResults) => {
    if (err) return res.status(500).json({ error: 'Database check failed' });
    if (resortResults.length > 0) return res.status(400).json({ error: 'Resort is already booked for these dates!' });

    // Check 2: Does this overlap with a Pool booking?
    const checkPoolSql = `SELECT id FROM pool_bookings WHERE DATE(booking_date) >= DATE(?) AND DATE(booking_date) <= DATE(?)`;
    
    db.query(checkPoolSql, [startDate, endDate], (err, poolResults) => {
      if (err) return res.status(500).json({ error: 'Database check failed' });
      if (poolResults.length > 0) return res.status(400).json({ error: 'A pool party is already booked during these dates!' });

      // No conflicts found, insert the booking
      const insertSql = 'INSERT INTO resort_bookings (guest_name, phone, start_date, end_date) VALUES (?, ?, ?, ?)';
      db.query(insertSql, [name, phone, startDate, endDate], (err) => {
        if (err) return res.status(500).json({ error: 'Database error during booking' });
        
        // --- SEND TELEGRAM ALERT ---
        const msg = `🌴 *New Resort Booking!*\n\n*Guest:* ${name}\n*Phone:* ${phone}\n*Dates:* ${startDate} to ${endDate}`;
        notifyOwnerTelegram(msg);

        res.json({ message: 'Resort booked successfully!' });
      });
    });
  });
});

// 4. Book Pool (Total Mutual Exclusivity + Telegram)
app.post('/api/book/pool', (req, res) => {
  const { name, phone, date } = req.body;

  // Check 1: Is the Pool already booked on this day?
  const checkPoolSql = `SELECT id FROM pool_bookings WHERE DATE(booking_date) = DATE(?)`;
  
  db.query(checkPoolSql, [date], (err, poolResults) => {
    if (err) return res.status(500).json({ error: 'Database check failed' });
    if (poolResults.length > 0) return res.status(400).json({ error: 'The pool is already booked for this date!' });

    // Check 2: Is the Resort booked on this day?
    const checkResortSql = `SELECT id FROM resort_bookings WHERE DATE(start_date) <= DATE(?) AND DATE(end_date) >= DATE(?)`;
    
    db.query(checkResortSql, [date, date], (err, resortResults) => {
      if (err) return res.status(500).json({ error: 'Database check failed' });
      if (resortResults.length > 0) return res.status(400).json({ error: 'The resort is booked, so the pool is unavailable!' });

      // No conflicts found, insert the booking
      const insertSql = 'INSERT INTO pool_bookings (guest_name, phone, booking_date) VALUES (?, ?, ?)';
      db.query(insertSql, [name, phone, date], (err) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        
        // --- SEND TELEGRAM ALERT ---
        const msg = `🏊 *New Pool Party!*\n\n*Guest:* ${name}\n*Phone:* ${phone}\n*Date:* ${date}`;
        notifyOwnerTelegram(msg);

        res.json({ message: 'Pool booked successfully!' });
      });
    });
  });
});

// --- SERVER START ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is live on port ${PORT}`);
});