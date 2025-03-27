const express = require('express');
const cors = require('cors');
const path = require('path');
const { 
  searchPages, 
  getPageContent, 
  getStats, 
  vacuumDatabase
} = require('./database');
const { 
  decompressData, 
  formatSize, 
  getCompressionRatio 
} = require('./compression');
const { 
  getAvailableTopics, 
  getTopicKeywords 
} = require('./classifier');

// Create Express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/**
 * API Routes
 */

// Search endpoint
app.get('/api/search', async (req, res) => {
  try {
    const { query, topics } = req.query;
    const topicList = topics ? topics.split(',') : [];
    const limit = parseInt(req.query.limit) || 100;
    
    const results = await searchPages(query, topicList, limit);
    
    // Format results
    const formattedResults = results.map(result => ({
      id: result.id,
      url: result.url,
      title: result.title,
      date: result.date_archived,
      topics: result.topics ? result.topics.split(',') : []
    }));
    
    res.json({ results: formattedResults });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get content endpoint
app.get('/api/content/:id', async (req, res) => {
  try {
    const page = await getPageContent(req.params.id);
    if (!page) {
      return res.status(404).json({ error: 'Content not found' });
    }
    
    const { compressed_content, url, title } = page;
    
    // Check content type requested (html or text)
    const format = req.query.format || 'html';
    
    // Decompress content
    const decompressedBuffer = await decompressData(compressed_content);
    const content = decompressedBuffer.toString('utf8');
    
    if (format === 'text') {
      // Strip HTML for text-only view
      const textContent = content.replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      res.json({ 
        title, 
        url, 
        content: textContent 
      });
    } else {
      // Return full HTML
      res.send(content);
    }
  } catch (error) {
    console.error('Content retrieval error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get stats
app.get('/api/stats', async (req, res) => {
  try {
    const dbStats = await getStats();
    
    // Format stats for frontend
    const stats = {
      totalPages: parseInt(dbStats.total_pages || 0),
      totalSizeRaw: formatSize(parseInt(dbStats.total_size_raw || 0)),
      totalSizeCompressed: formatSize(parseInt(dbStats.total_size_compressed || 0)),
      compressionRatio: getCompressionRatio(
        parseInt(dbStats.total_size_raw || 0), 
        parseInt(dbStats.total_size_compressed || 0)
      ),
      lastCrawlDate: dbStats.last_crawl_date,
      topTopics: dbStats.topTopics || [],
      queueStatus: dbStats.queue || {}
    };
    
    res.json(stats);
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get topics
app.get('/api/topics', (req, res) => {
  try {
    const topics = getAvailableTopics();
    
    // Get keywords if detailed mode requested
    const detailed = req.query.detailed === 'true';
    let result;
    
    if (detailed) {
      result = topics.map(topic => ({
        id: topic,
        name: topic.charAt(0).toUpperCase() + topic.slice(1),
        keywords: getTopicKeywords(topic).slice(0, 10) // First 10 keywords
      }));
    } else {
      result = topics.map(topic => ({
        id: topic,
        name: topic.charAt(0).toUpperCase() + topic.slice(1)
      }));
    }
    
    res.json(result);
  } catch (error) {
    console.error('Topics error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Maintenance endpoint
app.post('/api/maintenance', async (req, res) => {
  if (req.body.action === 'vacuum') {
    try {
      await vacuumDatabase();
      res.json({ success: true, message: 'Database optimized' });
    } catch (error) {
      console.error('Maintenance error:', error);
      res.status(500).json({ error: error.message });
    }
  } else {
    res.status(400).json({ error: 'Unknown maintenance action' });
  }
});

// Catch-all route for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Export server for use in main application
module.exports = {
  start: (port = 3000) => {
    app.listen(port, () => {
      console.log(`WorldEndArchive server running on port ${port}`);
    });
  }
}; 