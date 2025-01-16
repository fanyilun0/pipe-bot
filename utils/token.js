const fetch = require('node-fetch');
const fs = require('fs').promises;
const { HttpsProxyAgent } = require('https-proxy-agent');
const { logger } = require('./logger');
const { headers } = require('./file');
const { DATA_PATHS, CONFIG_PATHS } = require('../config');

const TOKEN_FILE = DATA_PATHS.TOKENS_FILE;
const ACCOUNT_FILE = CONFIG_PATHS.ACCOUNT_FILE;


// Helper function to add delay
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Function to save the token with retry mechanism
async function saveToken(data, retries = 3, backoff = 1000) {
  logger(`开始保存token - 用户: ${data.username}`, 'info');
  
  for (let i = 0; i < retries; i++) {
    try {
      const tempFile = `${TOKEN_FILE}.tmp`;
      
      let tokens = [];
      try {
        logger(`读取现有tokens文件: ${TOKEN_FILE}`, 'info');
        const fileData = await fs.readFile(TOKEN_FILE, 'utf8');
        tokens = JSON.parse(fileData);
        logger(`成功读取${tokens.length}个现有token`, 'info');
      } catch (error) {
        logger(`读取tokens文件失败: ${error.message}`, 'warn');
      }

      const tokenIndex = tokens.findIndex(token => token.username === data.username);
      
      if (tokenIndex !== -1) {
        tokens[tokenIndex] = data;
        logger(`更新用户${data.username}的token`, 'info');
      } else {
        tokens.push(data);
        logger(`添加用户${data.username}的新token`, 'info');
      }

      logger(`写入临时文件: ${tempFile}`, 'info');
      await fs.writeFile(tempFile, JSON.stringify(tokens, null, 2));

      try {
        logger(`重命名临时文件到: ${TOKEN_FILE}`, 'info');
        await fs.rename(tempFile, TOKEN_FILE);
        logger(`Token保存成功! 当前共有${tokens.length}个token`, 'success');
        return;
      } catch (renameError) {
        logger(`重命名失败: ${renameError.message}`, 'error');
        throw renameError;
      }
    } catch (error) {
      if (i === retries - 1) {
        logger(`Token保存最终失败: ${error.message}`, 'error');
        throw error;
      }
      logger(`重试保存token (${i + 2}/${retries})`, 'warn');
      await delay(backoff * Math.pow(2, i));
    }
  }
}

// 读取账号信息
async function readAccountCredentials() {
  try {
    if (!ACCOUNT_FILE) {
      throw new Error('Account file path is not defined');
    }
    
    logger(`Reading accounts from: ${ACCOUNT_FILE}`, 'info');
    const fileData = await fs.readFile(ACCOUNT_FILE, 'utf8');
    
    if (!fileData) {
      throw new Error('Account file is empty');
    }
    
    const accounts = fileData
      .split('\n')
      .filter(line => line.trim() !== '')
      .map(line => {
        const [email, password] = line.split(':').map(s => s.trim());
        return { email, password };
      });
      
    logger(`Successfully read ${accounts.length} accounts`, 'info');
    return accounts;
  } catch (error) {
    logger(`Error reading account credentials: ${error.message}`, 'error');
    throw new Error(`Failed to read account credentials: ${error.message}`);
  }
}

// 验证token
async function verifyToken(token, API_BASE) {
  try {
    const response = await fetch(`${API_BASE}/api/points`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        ...headers
      }
    });
    return response.status === 200;
  } catch (error) {
    logger('Error verifying token:', 'error', error);
    return false;
  }
}

// 获取已存token
async function getExistingToken(username) {
  try {
    logger(`尝试获取${username}的token`, 'info');
    const fileData = await fs.readFile(TOKEN_FILE, 'utf8');
    const tokens = JSON.parse(fileData);
    logger(`当前共有${tokens.length}个token记录`, 'info');
    const tokenData = tokens.find(t => t.username === username);
    if(tokenData) {
      logger(`找到${username}的token`, 'info');
    } else {
      logger(`未找到${username}的token`, 'info');
    }
    return tokenData?.token;
  } catch (error) {
    logger(`读取token失败: ${error.message}`, 'warn');
    return null;
  }
}

// 直接在token.js中实现token刷新逻辑
async function refreshToken(username, API_BASE, proxy) {
  try {
    // 获取账号信息
    const accounts = await readAccountCredentials();
    const account = accounts.find(acc => acc.email === username);

    if (!account) {
      throw new Error(`No credentials found for ${username}`);
    }

    // 直接进行登录请求获取新token
    const agent = new HttpsProxyAgent(proxy);
    const response = await fetch(`${API_BASE}/api/login`, {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        email: account.email,
        password: account.password
      }),
      agent
    });

    if (response.ok) {
      const data = await response.json();
      if (data.token) {
        // 保存新token
        await saveToken({ token: data.token, username });
        logger(`Token refreshed for ${username}`, 'success');
        return data.token;
      }
    }
    throw new Error(`Failed to refresh token for ${username}`);
  } catch (error) {
    logger(`Failed to refresh token for ${username}:`, 'error', error);
    throw error;
  }
}

// API调用的包装函数
async function withTokenRefresh(apiCall, username, token, API_BASE, proxy) {
  try {
    return await apiCall(token);
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      logger(`Token expired for ${username}, attempting refresh...`);
      const newToken = await refreshToken(username, API_BASE, proxy);
      if (newToken) {
        return await apiCall(newToken);
      }
    }
    throw error;
  }
}

module.exports = {
  verifyToken,
  getExistingToken,
  refreshToken,
  withTokenRefresh,
  saveToken
}; 
