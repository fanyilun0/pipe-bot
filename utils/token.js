const { login } = require('../services/login');
const { readToken, saveToken } = require('./file');
const { logger } = require('./logger');
const { readUsersFromFile } = require('../services/login');

// Token refresh function
async function refreshToken(username, API_BASE, proxy) {
    try {
        // Read stored credentials
        const accounts = await readUsersFromFile();
        const account = accounts.find(acc => acc.email === username);
        
        if (!account) {
            throw new Error(`No credentials found for ${username}`);
        }

        // Try to login again
        await login(account.email, account.password, API_BASE, proxy);
        logger(`Token refreshed for ${username}`, 'success');
        
        // Return the new token
        const tokens = await readToken();
        const newToken = tokens.find(t => t.username === username);
        return newToken?.token;
    } catch (error) {
        logger(`Failed to refresh token for ${username}:`, 'error', error);
        throw error;
    }
}

// Wrapper for API calls that handles token refresh
async function withTokenRefresh(apiCall, username, token, API_BASE, proxy) {
    try {
        return await apiCall(token);
    } catch (error) {
        if (error.status === 401 || error.status === 403) {
            logger(`Token expired for ${username}, attempting refresh...`);
            const newToken = await refreshToken(username, API_BASE, proxy);
            if (newToken) {
                // Retry the API call with new token
                return await apiCall(newToken);
            }
        }
        throw error;
    }
}

// 新增：验证token是否有效的函数
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

// 新增：获取已存token的函数
async function getExistingToken(username) {
  try {
      const fileData = await fs.readFile(TOKEN_FILE, 'utf8');
      const tokens = JSON.parse(fileData);
      const tokenData = tokens.find(t => t.username === username);
      return tokenData?.token;
  } catch (error) {
      return null;
  }
}

module.exports = { refreshToken, withTokenRefresh, verifyToken, getExistingToken }; 