const crypto = require('crypto');

/**
 * No compression - just returns raw data with hash
 * @param {Buffer|string} data - Data to store
 * @returns {Object} Result with uncompressed data and hash
 */
async function compressData(data) {
  // Ensure data is Buffer
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  
  // Create content hash for deduplication
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  
  // No compression - just return the original data
  return {
    compressed: buffer,
    hash: hash,
    originalSize: buffer.length,
    compressedSize: buffer.length
  };
}

/**
 * No decompression - just returns data as-is
 * @param {Buffer} data - Data to return
 * @returns {Buffer} Same data
 */
async function decompressData(data) {
  if (!data) {
    throw new Error('No data provided');
  }
  
  // Just return the data as-is
  return data;
}

/**
 * Returns human-readable size string
 * @param {number} bytes - Size in bytes
 * @returns {string} Human readable size
 */
function formatSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Calculates compression ratio
 * @param {number} original - Original size
 * @param {number} compressed - Compressed size
 * @returns {string} Formatted ratio
 */
function getCompressionRatio(original, compressed) {
  if (compressed === 0) return '0:0';
  const ratio = original / compressed;
  return `${ratio.toFixed(1)}:1`;
}

module.exports = {
  compressData,
  decompressData,
  formatSize,
  getCompressionRatio
}; 