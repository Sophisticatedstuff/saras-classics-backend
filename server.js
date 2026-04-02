const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Connect to Aiven Cloud Database
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  ssl: {
    rejectUnauthorized: false // Required for secure cloud connection
  }
});

db.connect(err => {
  if (err) {
    console.error('Database connection failed:', err);
    return;
  }
  console.log('Connected to Aiven Cloud MySQL Database!');

  // Auto-create our tables in the cloud so we don't have to do it manually!
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

// --- ROUTES ---
app.get('/api/stats', (req, res) => {
  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();

  db.query(`SELECT COUNT(*) as count FROM resort_bookings WHERE MONTH(start_date) = ? AND YEAR(start_date) = ?`, [currentMonth, currentYear], (err, resortResults) => {
    if (err) return res.status(500).json({ error: err.message });
    
    db.query(`SELECT COUNT(*) as count FROM pool_bookings WHERE MONTH(booking_date) = ? AND YEAR(booking_date) = ?`, [currentMonth, currentYear], (err, poolResults) => {
      if (err) return res.status(500).json({ error: err.message });
      
      res.json({
        currentMonthResortBookings: resortResults[0].count,
        currentMonthPoolBookings: poolResults[0].count
      });
    });
  });
});

app.get('/api/bookings', (req, res) => {
  db.query('SELECT * FROM resort_bookings', (err, resorts) => {
    if (err) return res.status(500).json({ error: err.message });
    
    db.query('SELECT * FROM pool_bookings', (err, pools) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ resorts, pools });
    });
  });
});

app.post('/api/book/resort', (req, res) => {
  const { name, phone, startDate, endDate } = req.body;
  db.query('INSERT INTO resort_bookings (guest_name, phone, start_date, end_date) VALUES (?, ?, ?, ?)', 
    [name, phone, startDate, endDate], 
    (err) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ message: 'Resort booked successfully!' });
  });
});

app.post('/api/book/pool', (req, res) => {
  const { name, phone, date } = req.body;
  db.query('INSERT INTO pool_bookings (guest_name, phone, booking_date) VALUES (?, ?, ?)', 
    [name, phone, date], 
    (err) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ message: 'Pool booked successfully!' });
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});