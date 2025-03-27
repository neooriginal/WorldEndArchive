# WorldEndArchive

**Knowledge Preservation System for the Apocalypse**

![WorldEndArchive](./public/images/radiation.svg)

## About

WorldEndArchive is a self-contained web crawler and archiving system designed to preserve human knowledge in case of internet infrastructure collapse or civilization breakdown. It systematically crawls the web, compressing and storing important information into a local SQLite database, which can then be searched and accessed offline.

## Features

- **Web Crawler**: Recursively crawls websites, following links to archive entire knowledge bases
- **Automatic Operation**: Starts crawling automatically when the application runs
- **Size Management**: Automatically stops when database reaches 8GB to prevent excessive storage use
- **Topic Classification**: Automatically categorizes content by topics using keyword analysis
- **Content Filtering**: Only archives content that matches defined knowledge categories
- **High-Ratio Compression**: Uses LZMA compression to minimize storage requirements
- **Full-Text Search**: Search archived content by keywords or topics
- **Post-Apocalyptic UI**: Terminal-inspired interface with CRT effects and nuclear aesthetics
- **Offline Operation**: Works entirely offline once content is archived
- **Persistent Storage**: SQLite3 database for reliable, portable storage

## Installation

### Prerequisites

- Node.js 14.x or higher
- npm or yarn

### Setup

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/worldendarchive.git
   cd worldendarchive
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Set up environment variables:
   ```
   cp .env.example .env
   ```
   Edit the `.env` file to adjust crawling parameters as needed.

## Usage

### Starting the application

Simply run:

```
npm start
```

This will:
1. Start the web server on port 3000 (or the port specified in your .env file)
2. Begin automatically crawling the web using recommended seed sites
3. Continue crawling until the database reaches 8GB in size

Visit `http://localhost:3000` to access the interface.

### Manual crawling (optional)

If you want to manually specify which websites to crawl:

```
npm run crawl-only https://example.com https://anothersite.org
```

This will override the automatic crawling process.

### Database maintenance

To optimize the database and reclaim space:

```
npm run vacuum
```

### Configuration Options

Key configuration options in `.env`:

- `MAX_DEPTH`: How deep to follow links (higher values mean more pages)
- `CONCURRENT_REQUESTS`: Number of parallel requests to make
- `ALLOWED_DOMAINS`: Restrict crawling to specific domains (comma-separated)
- `EXCLUDED_DOMAINS`: Domains to exclude from crawling

## Architecture

- **Crawler**: `crawler.js` - Handles website traversal and content extraction
- **Classifier**: `classifier.js` - Analyzes and categorizes content by topic
- **Compression**: `compression.js` - Compresses content with LZMA
- **Database**: `database.js` - Manages SQLite storage and retrieval
- **API**: `api.js` - Provides the search and content retrieval endpoints
- **Frontend**: `/public` - Contains the user interface

## Content Filtering

WorldEndArchive focuses on archiving valuable knowledge by:

1. Classifying content into defined knowledge categories
2. Only saving content that matches at least one category with sufficient confidence
3. Skipping content that is too short or lacks educational value
4. Prioritizing content from reputable educational and informational sites

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the ISC License.

## Emergency Usage

In case of actual civilization collapse:

1. Ensure you have a working computer with NodeJS runtime
2. Start the server: `npm start`
3. Access knowledge through the web interface at http://localhost:3000
4. Generator power recommended for extended usage in post-grid scenarios
