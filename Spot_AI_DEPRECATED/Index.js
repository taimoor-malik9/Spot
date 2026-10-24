const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const aiRoutes = require('./ai');
const resultsAiRoutes = require('./resultsAi');

const router = express.Router();
router.use('/', aiRoutes);
router.use('/', resultsAiRoutes);

module.exports = router;