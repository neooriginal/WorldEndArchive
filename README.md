# 🌍 WorldEndArchive

<p align="center">
  <img src="./images/image.png" alt="WorldEndArchive" width="600">
</p>

<div align="center">
  
  ![License](https://img.shields.io/badge/license-CC%20BY--NC%204.0-blue)
  ![Node](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen)
  ![Status](https://img.shields.io/badge/status-operational-success)
  
  **Preserving Humanity's Knowledge Against Digital Extinction**
  
</div>

<p align="center">
  <i>In a world of fragile infrastructure and ephemeral data, what knowledge would you save?</i>
</p>

## 📋 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [Installation](#-installation)
- [Usage](#-usage)
- [Configuration](#-configuration)
- [Architecture](#-architecture)
- [Content Filtering](#-content-filtering)
- [Contributing](#-contributing)
- [Emergency Usage](#-emergency-usage)
- [License](#-license)

## 🔍 Overview

WorldEndArchive is a digital Noah's Ark for human knowledge. As our increasingly complex digital infrastructure grows more vulnerable to disruption, this system ensures critical information survives catastrophic events by systematically crawling, compressing, and preserving important web content in a self-contained, offline-accessible archive.

The internet contains humanity's accumulated wisdom, but its accessibility depends on complex systems vulnerable to numerous threats - from solar flares to cyberattacks, from infrastructure decay to social collapse. WorldEndArchive transforms the ephemeral web into permanent, accessible knowledge that can survive these threats.

## ✨ Features

- **📡 Autonomous Web Crawler**: Recursively crawls websites, following links to archive entire knowledge bases
- **⚙️ Automatic Operation**: Starts crawling automatically when the application runs
- **💾 Size Management**: Automatically stops when database reaches 8GB to prevent excessive storage use
- **🧠 Topic Classification**: Categorizes content by topics using keyword analysis
- **🔍 Content Filtering**: Only archives content that matches defined knowledge categories
- **📦 High-Ratio Compression**: Uses LZMA compression to minimize storage requirements
- **🔎 Full-Text Search**: Search archived content by keywords or topics
- **🖥️ Post-Apocalyptic UI**: Terminal-inspired interface with CRT effects and nuclear aesthetics
- **🔌 Offline Operation**: Works entirely offline once content is archived
- **🗄️ Persistent Storage**: SQLite3 database for reliable, portable storage

## 🚀 Installation

### Prerequisites

- Node.js 14.x or higher
- npm or yarn

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/worldendarchive.git
   cd worldendarchive
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   ```
   Edit the `.env` file to adjust crawling parameters as needed.

## 🔨 Usage

### Starting the application

Simply run:

```bash
npm start
```

This will:
1. Start the web server on port 3000 (or the port specified in your .env file)
2. Begin automatically crawling the web using recommended seed sites
3. Continue crawling until the database reaches 8GB in size

Visit `http://localhost:3000` to access the interface.

### Manual crawling (optional)

If you want to manually specify which websites to crawl:

```bash
npm run crawl-only https://example.com https://anothersite.org
```

This will override the automatic crawling process.

### Database maintenance

To optimize the database and reclaim space:

```bash
npm run vacuum
```

### Standalone Apocalypse Mode

For offline use without any dependencies (ideal for disaster preparation):

1. Download your database using the download button in the UI
2. Copy the entire `/standalone` folder to your USB drive along with the database
3. Open `standalone/standalone.html` in any modern browser
4. Select your downloaded database file to load and search through the archived content

This standalone mode works on any operating system with a web browser and requires no installation or internet connection. **Consider creating multiple copies on different storage media for redundancy.**

#### How Standalone Mode Works

The standalone version (`/standalone` folder) contains:

- **standalone.html**: A self-contained HTML application with embedded CSS and JavaScript
- **sql-wasm.js**: A fallback library for handling SQLite databases in the browser

The application is designed to work completely offline by:
- Loading and querying SQLite databases directly in the browser
- Using IndexedDB for temporary storage when needed
- Not requiring any server components or installation
- Supporting searching by keywords and topics
- Working on any device with a modern browser

If you're preparing for a scenario without internet access, copying this folder along with your database to multiple storage devices provides a redundant way to access your archived knowledge.

## ⚙️ Configuration

Key configuration options in `.env`:

| Option | Description |
|--------|-------------|
| `MAX_DEPTH` | How deep to follow links (higher values mean more pages) |
| `CONCURRENT_REQUESTS` | Number of parallel requests to make |
| `ALLOWED_DOMAINS` | Restrict crawling to specific domains (comma-separated) |
| `EXCLUDED_DOMAINS` | Domains to exclude from crawling |
| `MAX_DB_SIZE_MB` | Maximum database size in MB (default: 8192) |

## 🏗️ Architecture

- **Crawler**: `crawler.js` - Handles website traversal and content extraction
- **Classifier**: `classifier.js` - Analyzes and categorizes content by topic
- **Compression**: `compression.js` - Compresses content with LZMA
- **Database**: `database.js` - Manages SQLite storage and retrieval
- **API**: `api.js` - Provides the search and content retrieval endpoints
- **Frontend**: `/public` - Contains the user interface

## 🧩 Content Filtering

WorldEndArchive prioritizes knowledge critical for rebuilding civilization:

1. Classifying content into defined knowledge categories:
   - Survival & Emergency Preparedness
   - Medicine & Healthcare
   - Technology & Computing
   - Science & Research
   - Agriculture & Food Production
   - Engineering & Construction
   - Mathematics & Logic
   - History & Civilization
   - Philosophy & Ethics

2. Prioritizing content based on weighted topic importance:
   - High priority: Medicine, Science, Survival, Engineering
   - Medium priority: Mathematics, Computing, Agriculture
   - Lower priority: Entertainment

3. Skipping content that is too short or lacks educational value

## 👥 Contributing

Contributions are welcome! This project represents a collective effort to preserve human knowledge. Please feel free to submit a Pull Request to improve our digital ark.

## 🚨 Emergency Usage

In case of severe infrastructure disruption or societal instability:

1. Use battery, solar, or generator power to run a computer with this software
2. Start the server: `npm start` (if Node.js is available)
3. Access knowledge through the web interface at http://localhost:3000
4. If Node.js is unavailable, use the standalone version in the `/standalone` folder
5. Share your knowledge database with trusted communities to strengthen collective resilience

Remember: Information that seems mundane today may be irreplaceable tomorrow.

## 📄 License

This project is licensed under the [Creative Commons Attribution-NonCommercial 4.0 International License (CC BY-NC 4.0)](http://creativecommons.org/licenses/by-nc/4.0/).

This means:
- ✅ You can share, copy, and redistribute the material
- ✅ You can adapt, remix, transform, and build upon the material
- ⛔ You cannot use the material for commercial purposes
- ⚠️ You must give appropriate credit and indicate if changes were made

See the [LICENSE](./LICENSE) file for details.

---

<p align="center">
  <i>"The greatest glory of a building is not in its stones, nor in its gold. Its glory is in its endurance." - John Ruskin</i>
</p>
