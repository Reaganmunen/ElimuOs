require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const mainRoutes = require('./src/routes/main.routes');
const errorMiddleware = require('./src/middleware/error.middleware');
const ApiError = require('./src/utils/ApiError');

const app = express();

app.use(
  helmet({
    // Allow the CDN-hosted Bootstrap/Google Fonts the landing page pulls in.
    // Tighten this to your actual asset hosts before going to production.
    contentSecurityPolicy: false,
  })
);
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
app.use(express.json());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

// Serve the public/ frontend (landing page, and any future static pages)
// before the API routes, so static files are handled without touching
// mainRoutes or the API 404 handler below.
app.use(express.static(path.join(__dirname, 'public')));

// Every API route in the backend lives under mainRoutes — this is the
// only route-related import app.js needs, regardless of how many feature
// modules (fees, assessments, attendance...) get added later.
app.use('/api/v1', mainRoutes);

// Unmatched routes.
// API calls get a JSON 404 via the error middleware; anything else
// (a mistyped page path) falls back to the public 404 page if present,
// otherwise the same JSON error.
app.use((req, res, next) => {
  if (req.originalUrl.startsWith('/api/')) {
    return next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
  }

  const notFoundPage = path.join(__dirname, 'public', '404.html');
  return res.status(404).sendFile(notFoundPage, (err) => {
    if (err) next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
  });
});

app.use(errorMiddleware);

module.exports = app;