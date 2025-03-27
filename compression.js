const lzma = require('lzma-native');
const crypto = require('crypto');

/**
 * Compresses data using LZMA with high compression level
 * @param {Buffer|string} data - Data to compress
 * @param {number} level - Compression level (1-9)
 * @returns {Object} Result with compressed data, hash, and sizes
 */
async function compressData(data, level = 9) {
  // Ensure data is Buffer
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  
  // Create content hash for deduplication
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  
  // Compress with LZMA
  const compressedData = await lzma.compress(buffer, level);
  
  return {
    compressed: compressedData,
    hash: hash,
    originalSize: buffer.length,
    compressedSize: compressedData.length
  };
}

/**
 * Decompresses LZMA data
 * @param {Buffer} compressedData - LZMA compressed data
 * @returns {Buffer} Decompressed data
 */
async function decompressData(compressedData) {
  if (!compressedData) {
    throw new Error('No data provided for decompression');
  }
  
  try {
    return await lzma.decompress(compressedData);
  } catch (error) {
    throw new Error(`Decompression failed: ${error.message}`);
  }
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