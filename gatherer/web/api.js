const express = require('express');
const path = require('path');
const crawler = require('../utils/crawler');
const storage = require('../utils/storage');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { logger, logStream } = require('../utils/logger');

const router = express.Router();

// SSE Endpoint for logs
router.get('/logs/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const onLog = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    logStream.on('log', onLog);

    req.on('close', () => {
        logStream.off('log', onLog);
    });
});

// Serve static files
router.use(express.static(path.join(__dirname, 'public')));

// Stats endpoint
router.get('/stats', (req, res) => {
    const crawlerStats = crawler.getStats();
    storage.getStats((storageStats) => {
        res.json({
            crawler: crawlerStats,
            storage: storageStats,
            uptime: process.uptime()
        });
    });
});

// Add URL endpoint
router.post('/add-url', express.json(), (req, res) => {
    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }
    try {
        new URL(url); // Validate URL
        crawler.addToQueue(url, true); // Add with priority
        logger.info(`Manual URL added: ${url}`);
        res.json({ success: true, message: 'URL added to queue with priority.' });
    } catch (e) {
        res.status(400).json({ error: 'Invalid URL format' });
    }
});


// Download endpoints
router.get('/download/txt', (req, res) => {
    const archiver = require('archiver');
    const outputDir = storage.outputDir;

    // Find all TXT archive files
    const files = fs.readdirSync(outputDir).filter(f =>
        f === 'archive.txt' || f.startsWith('archive_') && f.endsWith('.txt')
    );

    if (files.length === 0) {
        return res.status(404).send('No archive files found yet.');
    }

    // Create ZIP archive
    const archive = archiver('zip', { zlib: { level: 9 } });

    res.attachment('worldendarchive_txt.zip');
    archive.pipe(res);

    // Add all TXT files to the ZIP
    files.forEach(file => {
        const filePath = path.join(outputDir, file);
        archive.file(filePath, { name: file });
    });

    archive.finalize();
});

router.get('/download/db', (req, res) => {
    const file = storage.dbPath;
    if (fs.existsSync(file)) {
        res.download(file, 'archive.db');
    } else {
        res.status(404).send('Database file not found yet.');
    }
});

// Download offline package (client + DB + TXT for USB)
router.get('/download/offline-package', async (req, res) => {
    const archiver = require('archiver');
    const os = require('os');
    const { promisify } = require('util');
    const { exec } = require('child_process');
    const execAsync = promisify(exec);

    try {
        const archive = archiver('zip', { zlib: { level: 6 } });
        res.attachment('WorldEndArchive_Offline.zip');
        archive.pipe(res);


        // README for emergency use (no internet assumed)
        const readme = `╔══════════════════════════════════════════════════════════════╗
║                  WORLDENDARCHIVE                             ║
║              Preserved Knowledge Repository                  ║
╚══════════════════════════════════════════════════════════════╝

IF YOU'RE READING THIS, YOU HAVE ACCESS TO PRESERVED KNOWLEDGE.

This USB stick contains an offline archive that works WITHOUT internet.
Everything you need is already on this stick.

═══════════════════════════════════════════════════════════════

⚠️  IMPORTANT - READ THIS FIRST:

This archive is READY TO USE. All files are already here.
You just need to run it on a computer.

═══════════════════════════════════════════════════════════════

🚀 HOW TO USE THIS ARCHIVE:

STEP 1: Insert this USB stick into any computer
        (Windows, Mac, or Linux)

STEP 2: Open the terminal/command prompt:
        - Windows: Press Windows key, type "cmd", press Enter
        - Mac: Press Cmd+Space, type "terminal", press Enter  
        - Linux: Press Ctrl+Alt+T

STEP 3: Navigate to this USB stick's client folder:
        Type: cd [path-to-this-usb]/client
        
        Examples:
        Windows: cd E:\\client
        Mac: cd /Volumes/USB_NAME/client
        Linux: cd /media/USB_NAME/client

STEP 4: Start the archive:
        Type: node server.js
        Press Enter

STEP 5: Open any web browser and go to:
        http://localhost:3001

The archive is now running!

═══════════════════════════════════════════════════════════════

📂 WHAT'S ON THIS USB STICK:

- Complete searchable archive of web pages
- Raw text files in txt_archive/ (readable without the app)
- All software needed to run the archive
- This works 100% OFFLINE

═══════════════════════════════════════════════════════════════

❓ IF SOMETHING GOES WRONG:

Problem: "node is not recognized" or "command not found"
→ Node.js is not installed on this computer
→ Check if there's a Node.js installer on this USB
→ Or use the txt_archive/ folder - it's just text files

Problem: Nothing happens at localhost:3001
→ Make sure server.js is still running in terminal
→ Try a different browser

Problem: Port 3001 already in use
→ Close other programs or restart the computer

═══════════════════════════════════════════════════════════════

💾 ALTERNATIVE: READING RAW TEXT FILES

If you can't run the server, you can still access the content:
1. Open the txt_archive/ folder
2. The .txt files contain all archived content
3. Open them with any text editor (Notepad, TextEdit, etc.)
4. Search manually using your text editor's search function

═══════════════════════════════════════════════════════════════

🔄 PRESERVING THIS ARCHIVE:

- Make copies of this USB stick if possible
- Keep it in a safe, dry place
- Share with others who need access to knowledge
- The information here could be valuable

═══════════════════════════════════════════════════════════════

📖 USING THE WEB INTERFACE:

Once running:
- Use the search bar to find topics
- Click results to read full archived pages
- Everything is stored locally on this USB
- Press Ctrl+C in terminal to stop the server

═══════════════════════════════════════════════════════════════

⚡ IMMEDIATE SURVIVAL PRIORITIES:

If you're in an emergency, remember the rule of threes:
- 3 minutes without air
- 3 hours without shelter (in harsh conditions)
- 3 days without water
- 3 weeks without food

PRIORITIZE IN THIS ORDER:
1. Safety and security first
2. Clean water (search: "water purification" "boiling water")
3. Shelter from elements
4. Food and nutrition
5. Medical knowledge (search: "first aid" "emergency medicine")

═══════════════════════════════════════════════════════════════

📚 USEFUL TOPICS IN THIS ARCHIVE:

Search for these essential topics:
- "water purification" - How to make water safe
- "first aid" - Basic medical treatment
- "edible plants" - Wild food identification
- "shelter building" - Emergency housing
- "fire starting" - Various methods
- "food preservation" - Long-term storage
- "basic tools" - Making essential items
- "survival skills" - General knowledge
- "emergency preparedness" - Planning
- "growing food" - Agriculture basics

═══════════════════════════════════════════════════════════════

💡 WORDS OF WISDOM:

Knowledge is humanity's greatest tool for survival and recovery.
What you hold in your hands is a collection of human knowledge
preserved for moments like this.

SHARE THIS ARCHIVE:
- Make copies for others
- Teach what you learn
- Build communities around shared knowledge
- The more people who have this, the better

LEARN AND ADAPT:
- Read multiple sources on important topics
- Test knowledge safely when possible
- Share successful techniques with others
- Document new discoveries

STAY HOPEFUL:
- Humans have survived worse and rebuilt
- Knowledge + cooperation = resilience
- Every person who learns can teach others
- You's not alone if you have this archive

═══════════════════════════════════════════════════════════════

🔄 PRESERVING THIS ARCHIVE:

This archive was created to preserve important knowledge
for when it might be needed most.

Use it wisely. Share it freely.
`;

        // Installation guide for preparing the USB (while internet exists)
        const installation = `╔══════════════════════════════════════════════════════════════╗
║           WORLDENDARCHIVE - INSTALLATION GUIDE               ║
║              How to Prepare the USB Stick                    ║
╚══════════════════════════════════════════════════════════════╝

This guide is for preparing the WorldEndArchive offline package
for USB deployment. Follow these steps while you still have internet.

═══════════════════════════════════════════════════════════════

📋 WHAT YOU'RE CREATING:

A self-contained USB stick that can run the archive completely
offline on any computer. This is for emergency preparedness.

═══════════════════════════════════════════════════════════════

🛠️ PREPARATION STEPS:

STEP 1: Download and extract this archive
        - You've already done this!

STEP 2: Copy the ENTIRE extracted folder to your USB stick
        - Make sure you copy everything, including:
          * client/ folder (with node_modules)
          * txt_archive/ folder
          * README.txt
          * This INSTALLATION.txt file

STEP 3: (OPTIONAL) Add Node.js installer to the USB:
        - Go to nodejs.org
        - Download the LTS installer for Windows/Mac/Linux
        - Put the installer on the USB stick
        - This allows installation on computers without internet

STEP 4: Test the setup:
        - Navigate to client/ on the USB
        - Run: node server.js
        - Visit: http://localhost:3001
        - Verify the archive works

STEP 5: Make backup copies
        - Copy to multiple USB sticks
        - Store in different locations
        - Update periodically with new archives

═══════════════════════════════════════════════════════════════

📦 WHAT'S INCLUDED:

✓ client/              - Full application with all dependencies
✓ client/node_modules/ - All required Node.js packages
✓ client/public/       - Web interface files
✓ archive.db           - SQLite database with all content
✓ txt_archive/         - Plain text versions of all pages
✓ README.txt           - Instructions for emergency use

═══════════════════════════════════════════════════════════════

💡 BEST PRACTICES:

1. Use a reliable USB stick (16GB+ recommended)
2. Test the USB on different computers
3. Update the archive regularly (re-download package)
4. Keep copies in multiple locations
5. Include the Node.js installer if possible
6. Add other important files (PDFs, documents, etc.)

═══════════════════════════════════════════════════════════════

🔧 TECHNICAL NOTES:

- The archive uses Node.js and SQLite
- No internet connection required after setup
- Database is in client/public/archive.db
- Text files are human-readable backups
- Works on Windows, Mac, and Linux

═══════════════════════════════════════════════════════════════

📝 MAINTENANCE:

To update the archive with new content:
1. Download a fresh offline package
2. Replace the old files on the USB
3. Test to ensure it still works
4. Update all backup copies

═══════════════════════════════════════════════════════════════

This preparation ensures access to knowledge even if
internet infrastructure becomes unavailable.

Prepare now. Hope you never need it.

For more info: github.com/neooriginal/WorldEndArchive
`;

        archive.append(readme, { name: 'README.txt' });
        archive.append(installation, { name: 'INSTALLATION.txt' });

        // Add client app (full directory with node_modules)
        const clientPath = path.resolve(__dirname, '../../client');
        archive.directory(clientPath, 'client', {
            filter: (filePath) => {
                // Exclude unnecessary files
                const relativePath = path.relative(clientPath, filePath);
                return !relativePath.includes('.git') &&
                    !relativePath.includes('.DS_Store') &&
                    !relativePath.endsWith('.log');
            }
        });

        // Copy archive.db to client/public/ in the ZIP
        const dbPath = storage.dbPath;
        if (fs.existsSync(dbPath)) {
            archive.file(dbPath, { name: 'client/public/archive.db' });
        }

        // Add all TXT files
        const outputDir = storage.outputDir;
        const txtFiles = fs.readdirSync(outputDir).filter(f =>
            f === 'archive.txt' || (f.startsWith('archive_') && f.endsWith('.txt'))
        );

        txtFiles.forEach(file => {
            const filePath = path.join(outputDir, file);
            archive.file(filePath, { name: `txt_archive/${file}` });
        });

        archive.finalize();

    } catch (error) {
        logger.error(`Error creating offline package: ${error.message}`);
        res.status(500).send('Error creating package');
    }
});

module.exports = router;

// Standalone server startup if needed, but usually called from index.js
// We'll export the app setup function or just the router
const app = express();
app.use(express.json());
app.use('/', router);

const PORT = process.env.PORT || 3000;

function startServer() {
    app.listen(PORT, () => {
        logger.info(`Web interface running on port ${PORT}`);
    });
}

module.exports = { startServer, app, logger };
const fs = require('fs'); // Added missing require
