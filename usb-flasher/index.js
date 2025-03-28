const usbDetect = require('usb-detection');
const fs = require('fs-extra');
const drivelist = require('drivelist');
const path = require('path');
const chalk = require('chalk');

// Path to the standalone folder (use absolute path)
const STANDALONE_FOLDER = path.resolve(__dirname, '../standalone');

// Track drives we've already processed
const processedDrives = new Set();

// State to prevent concurrent copies
let isCopying = false;

// Initialize USB detection
usbDetect.startMonitoring();

console.log(chalk.red("Warning: Put .db file in the standalone folder before running this script"));

console.log(chalk.blue('✓ USB Flasher Started'));
console.log(chalk.green(`Files will be flashed to: ${STANDALONE_FOLDER}`));
console.log(chalk.yellow('Insert a USB drive to automatically flash files...'));

// Function to get all available drives
async function getAvailableDrives() {
  try {
    return await drivelist.list();
  } catch (error) {
    console.error(chalk.red('Error listing drives:'), error.message);
    return [];
  }
}

// Function to detect new drives
async function checkForNewDrives() {
  if (isCopying) return;
  
  try {
    const drives = await getAvailableDrives();
    
    for (const drive of drives) {
      // Skip internal drives and already processed drives
      if (!drive.isUSB || !drive.mountpoints || drive.mountpoints.length === 0) continue;
      
      for (const mountpoint of drive.mountpoints) {
        const drivePath = mountpoint.path;
        
        if (!processedDrives.has(drivePath)) {
          // Mark this drive as being processed
          isCopying = true;
          processedDrives.add(drivePath);
          
          await copyFilesToDrive(drivePath, drive.description || 'USB Drive');
          
          // Allow processing next drive
          isCopying = false;
        }
      }
    }
  } catch (error) {
    console.error(chalk.red('Error checking for new drives:'), error.message);
    isCopying = false;
  }
}

// Function to copy files to the USB drive
async function copyFilesToDrive(drivePath, driveDescription) {
  const startTime = Date.now();
  console.log(chalk.blue(`\n🔍 New drive detected: ${driveDescription}`));
  console.log(chalk.yellow(`Beginning copy to ${drivePath}...`));
  
  try {
    // Create directory on the USB drive if it doesn't exist
    const targetDir = path.join(drivePath, 'standalone');
    await fs.ensureDir(targetDir);
    
    // Copy all files from the standalone folder to the USB drive
    await fs.copy(STANDALONE_FOLDER, targetDir, { overwrite: true });
    
    const endTime = Date.now();
    const timeElapsed = ((endTime - startTime) / 1000).toFixed(2);
    
    console.log(chalk.green(`✓ Copy completed successfully in ${timeElapsed} seconds!`));
    console.log(chalk.green(`Files copied to: ${targetDir}`));
    console.log(chalk.yellow('You can now safely remove the drive'));
    console.log(chalk.blue('Waiting for new USB drive...'));
  } catch (error) {
    console.error(chalk.red(`Error copying files to ${drivePath}:`), error.message);
    
    // If we encountered an error, remove this drive from processed list
    // so we can try again if the drive is reinserted
    processedDrives.delete(drivePath);
  }
}

// Check for USB drive changes every 2 seconds
setInterval(checkForNewDrives, 2000);

// Also check on USB device add/remove events
usbDetect.on('add', async () => {
  // Wait a moment for the OS to mount the drive
  setTimeout(checkForNewDrives, 1500);
});

// Process command to reset a drive (for testing)
process.stdin.on('data', (data) => {
  const input = data.toString().trim().toLowerCase();
  if (input === 'reset') {
    console.log(chalk.yellow('Resetting processed drives list...'));
    processedDrives.clear();
    console.log(chalk.green('✓ Reset complete. Next USB insertion will be processed.'));
  } else if (input === 'exit' || input === 'quit') {
    console.log(chalk.yellow('Shutting down...'));
    usbDetect.stopMonitoring();
    process.exit(0);
  }
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(chalk.yellow('\nShutting down USB monitoring...'));
  usbDetect.stopMonitoring();
  process.exit(0);
}); 