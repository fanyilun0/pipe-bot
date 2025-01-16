const { loginWithAllAccounts } = require("./services/login");
const { register } = require("./services/register");
const { sendHeartbeat, checkForRewards } = require("./services/heartbeat");
const { runNodeTests, fetchBaseUrl } = require("./services/nodes");
const { askQuestion } = require("./utils/userInput");
const { banner } = require("./utils/banner");
const { logger } = require("./utils/logger");
const { ensureDirectories } = require('./config');

// Time intervals
const BASE_URL_REFRESH_INTERVAL = 60 * 60 * 1000; // 60 minutes
const HEARTBEAT_INTERVAL = 6 * 60 * 60 * 1000;    // 6 hours  
const NODE_TEST_INTERVAL = 30 * 60 * 1000;        // 30 minutes
const REWARDS_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
let baseUrl = 'https://api.pipecdn.app'

// Ensure base URL is initialized
async function ensureBaseUrl() {
    if (!baseUrl || baseUrl === 'https://api.pipecdn.app') {
        logger('Initializing base URL...');
        baseUrl = await fetchBaseUrl(baseUrl);
        logger('Base URL initialized to:', 'info', baseUrl);
        return baseUrl;
    }
}

async function showMenu() {
    const choice = await askQuestion(
        "Choose an option:\n1. Register\n2. Login\n3. Run Node\n> "
    );

    switch (choice) {
        case "1":
            baseUrl = await ensureBaseUrl();
            logger("Registering new account...");
            await register(baseUrl);
            await showMenu();
            break;
        case "2":
            baseUrl = await ensureBaseUrl();
            logger("Fetching Accounts in accounts.json and logging in...");
            await loginWithAllAccounts(baseUrl);
            await showMenu();
            break;
        case "3":
            baseUrl = await ensureBaseUrl();
            logger("Running All Accounts using Proxy...");
            await sendHeartbeat(baseUrl);
            setInterval(() => sendHeartbeat(baseUrl), HEARTBEAT_INTERVAL);
            await runNodeTests(baseUrl);
            setInterval(() => runNodeTests(baseUrl), NODE_TEST_INTERVAL);
            // Not working
            // await checkForRewards(baseUrl);
            // setInterval(() => checkForRewards(baseUrl), REWARDS_CHECK_INTERVAL);
            logger(
                "Heartbeat: 6h, Node tests: 30m, Rewards check: 24h",
                "debug"
            );
            logger("Do not change this or your accounts might get banned.", "debug");
            break;
        default:
            logger("Invalid choice. Exiting.", "error");
            await showMenu();
    }
}

(async () => {
    logger(banner, "debug");
    await ensureDirectories();
    // Refresh the base URL periodically
    setInterval(async () => {
        baseUrl = await fetchBaseUrl();
        logger('Base URL refreshed:', baseUrl);
    }, BASE_URL_REFRESH_INTERVAL);

    await showMenu();
})();
