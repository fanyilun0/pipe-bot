const path = require('path');
const fs = require('fs').promises;

// 基础路径
const CONFIG_DIR = path.join(__dirname); // config目录
const DATA_DIR = path.join(__dirname, '..', 'data'); // data目录

// 配置文件路径
const CONFIG_PATHS = {
  ACCOUNT_FILE: path.join(CONFIG_DIR, 'accounts.txt'),
  PROXY_FILE: path.join(CONFIG_DIR, 'proxy.txt')
};

// 数据文件路径
const DATA_PATHS = {
  POINTS_FILE: path.join(DATA_DIR, 'points.json'),
  TOKENS_FILE: path.join(DATA_DIR, 'tokens.json'),
  RUNTIME_FILE: path.join(DATA_DIR, 'runtimes.json'),
};

// Time intervals
const BASE_URL_REFRESH_INTERVAL = 24 * 60 * 60 * 1000; // 60 minutes
const HEARTBEAT_INTERVAL = 6 * 60 * 60 * 1000;    // 6 hours  
const NODE_TEST_INTERVAL = 30 * 60 * 1000;        // 30 minutes
const REWARDS_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

const TIME_INTERVALS = {
  BASE_URL_REFRESH_INTERVAL,
  HEARTBEAT_INTERVAL,
  NODE_TEST_INTERVAL,
  REWARDS_CHECK_INTERVAL
};

// 确保目录存在
async function ensureDirectories() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating directories:', error);
  }
}

module.exports = {
  CONFIG_PATHS,
  DATA_PATHS,
  ensureDirectories,
  TIME_INTERVALS
};
