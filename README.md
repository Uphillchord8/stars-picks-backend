# stars-picks-backend

# Node.js \& MongoDB backend for a Dallas Stars game‐prediction site. Users sign up, make first‐goal and game‐winning‐goal picks, and view leaderboards and stats. Cron jobs apply default picks and update player goal tallies nightly.

# 

# Features

# \- User authentication with JWT

# \- Role-free signup, login, password reset via email

# \- Protected endpoints for submitting and retrieving picks

# \- Public endpoints for games, players, stats, and leaderboard

# \- Avatar upload and default‐pick settings

# \- Cron jobs to:

# \- Apply users’ default picks 15 minutes before games

# \- Recalculate each player’s total first goals nightly

# 

# Table of Contents

# \- Getting Started

# \- Environment Variables

# \- Available Scripts

# \- API Endpoints

# \- Cron Jobs

# \- Project Structure

# \- Dependencies

# \- License

# 

# Getting Started

# Prerequisites

# \- Node.js v16 or higher

# \- MongoDB connection (cloud-hosted or local)

# Installation

# \- Clone the repository

# git clone https://github.com/your-org/stars-picks-backend.git

# cd stars-picks-backend

# \- Install dependencies

# npm install

# \- Copy and customize environment variables

# cp .env.example .env

# \# Edit .env with your real values

# \- Start the server in development

# npm run dev

# 

# 

# The backend listens on port 4000 by default.

# 

# Environment Variables

# Copy .env.example → .env and fill in:

# | Variable | Description | 

# | MONGO\_URI | MongoDB connection URI | 

# | JWT\_SECRET | Secret key for signing JWTs | 

# | NODE\_ENV | development or production | 

# | NHL\_API\_CACHE\_TTL | Cache duration for NHL API responses (minutes) | 

# | FRONTEND\_URL | Frontend origin (for CORS in production) | 

# | REACT\_APP\_API\_URL | Base URL for frontend to call this API | 

# | SMTP\_HOST | SMTP server hostname (for password reset emails) | 

# | SMTP\_PORT | SMTP server port | 

# | SMTP\_USER | SMTP authentication username | 

# | SMTP\_PASS | SMTP authentication password | 

# 

# 

# 

# Available Scripts

# In the project directory:

# \- npm run dev

# Starts the server in development mode with nodemon and verbose logging.

# \- npm start

# Starts the server in production mode (NODE\_ENV=production).

# 

# API Endpoints

# Authentication

# \- POST /api/auth/signup

# Body: { username, email, password }

# Registers a new user, returns { token, user }.

# \- POST /api/auth/login

# Body: { username, password, remember? }

# Logs in, returns { token, user }.

# \- POST /api/auth/forgot

# Body: { email }

# Sends a password reset link if the email exists.

# \- POST /api/auth/reset

# Body: { userId, token, newPassword }

# Resets password with a valid token.

# Public Data

# \- GET /api/players

# Returns all players.

# \- GET /api/games

# Returns active games with logos and Stars roster.

# \- GET /api/stats

# Returns last game highlights and season stats.

# \- GET /api/leaderboard

# Query: period=week|month|season (default: season)

# Returns leaderboard standings.

# Protected (Require Authorization)

# Include header Authorization: Bearer <token>.

# \- GET /api/picks

# Returns current user’s picks.

# \- POST /api/picks

# Body: { gameId, firstGoalPlayerId, gwGoalPlayerId }

# Creates or updates a pick (locked 5 min before game start).

# \- GET /api/picks/game/:gameId

# Returns all users’ picks for a specific game.

# \- POST /api/user/avatar

# Form-data: avatar (file)

# Uploads user avatar.

# \- POST /api/user/defaults

# Body: { defaultFirstGoal?, defaultGWG? }

# Saves default pick settings.

# 

# Cron Jobs

# Cron jobs start automatically when the server boots.

# \- defaultPicks.js

# Schedule: \*/15 \* \* \* \*

# Applies users’ default picks to games starting in the next hour.

# \- recalcSeasonGoals.js

# Schedule: 0 3 \* \* \*

# Recalculates each player’s total first goals nightly at 3 AM.

# 

# Project Structure

# stars-picks-backend/

# ├── .github/              # CI workflows

# ├── public/

# │   └── avatars/          # Uploaded avatar files

# ├── src/

# │   ├── cron/             # Scheduled jobs

# │   ├── controllers/      # Route handlers / business logic

# │   ├── middleware/       # JWT auth guard, request validators

# │   ├── models/           # Mongoose schemas

# │   ├── routes/           # Express routers

# │   └── db.js             # Central MongoDB connection

# ├── .env.example

# ├── .gitignore

# ├── package.json

# └── server.js

# 

# 

# 

# Dependencies

# \- express, mongoose, cors, dotenv, helmet

# \- bcrypt, jsonwebtoken, multer, node-cron, nodemailer

# \- axios for NHL API calls

# DevDependencies:

# \- nodemon, cross-env

# 

# License

# This project is licensed under the MIT License.

# See the LICENSE file for details



