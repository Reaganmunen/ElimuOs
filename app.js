require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const mainRoutes = require('./src/routes/main.routes');
const errorMiddleware = require('./src/middleware/error.middleware');
const ApiError = require('./src/utils/ApiError');

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
app.use(express.json());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

// Every route in the entire backend lives under mainRoutes — this is the
// only route-related import app.js needs, regardless of how many feature
// modules (fees, assessments, attendance...) get added later.
app.use('/api/v1', mainRoutes);

// Unmatched routes
app.use((req, res, next) => {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
});

app.use(errorMiddleware);

module.exports = app;
