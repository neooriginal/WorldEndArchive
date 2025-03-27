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
- [System Architecture](#-system-architecture)
- [Installation](#-installation)
- [Usage](#-usage)
- [Configuration](#-configuration)
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

## 🏗️ System Architecture

WorldEndArchive uses a two-component architecture:

1. **Crawler Component** (`Main Application`)
   - Handles web crawling and content archiving
   - Builds and maintains the SQLite database
   - Provides database download functionality
   - Runs as a Node.js application

2. **Reader Component** (`Standalone Application`)
   - Provides search and retrieval functionality
   - Works completely offline without server components
   - Can be used with any web browser
   - Located in the `/standalone` folder

This separation ensures that the knowledge archiving process can run on a powerful server, while the knowledge retrieval can be performed on any device with a browser, even in offline scenarios.

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

### Running the Crawler

To start the web crawler and build your knowledge archive:

```bash
npm start
```

This will:
1. Start the server on port 3000 (or the port specified in your .env file)
2. Begin automatically crawling the web using recommended seed sites
3. Continue crawling until the database reaches 8GB in size
4. Serve the standalone app at http://localhost:3000 for browsing the archive

### Manual crawling (optional)

If you want to manually specify which websites to crawl:

```bash
npm run crawl-only https://example.com https://anothersite.org
```

This will override the automatic crawling process.

### Accessing Your Archive

Once the crawler has collected knowledge:

1. **Web Interface**: Visit `http://localhost:3000` to access the standalone reader in your browser
2. **Download Database**: Use the download button to save the database file
3. **Offline Access**: Copy the `/standalone` folder and your database file to any storage device

### Standalone Mode

For complete offline usage:

1. Copy the entire `/standalone` folder to your storage medium (USB drive, etc.)
2. Add your database file to the same location
3. Open `standalone.html` in any modern web browser
4. Select your database file when prompted

This standalone mode works on any operating system with a web browser and requires no installation or internet connection. **Consider creating multiple copies on different storage media for redundancy.**

## ⚙️ Configuration

Key configuration options in `.env`:

| Option | Description |
|--------|-------------|
| `MAX_DEPTH` | How deep to follow links (higher values mean more pages) |
| `CONCURRENT_REQUESTS` | Number of parallel requests to make |
| `ALLOWED_DOMAINS` | Restrict crawling to specific domains (comma-separated) |
| `EXCLUDED_DOMAINS` | Domains to exclude from crawling |
| `MAX_DB_SIZE_MB` | Maximum database size in MB (default: 8192) |

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

1. Use battery, solar, or generator power to run a computer
2. Access the standalone version in the `/standalone` folder directly with any browser
3. If you have multiple storage locations, use the database file with the most recent date
4. Share your knowledge database with trusted communities to strengthen collective resilience

Remember: Information that seems mundane today may be irreplaceable tomorrow.

## 📄 License

This project is licensed under the [Creative Commons Attribution-NonCommercial 4.0 International License (CC BY-NC 4.0)](http://creativecommons.org/licenses/by-nc/4.0/).

This means:
- ✅ You can share, copy, and redistribute the material
- ✅ You can adapt, remix, transform, and build upon the material
- ⛔ You cannot use the material for commercial purposes
- ⚠️ You must give appropriate credit and indicate if changes were made

The license includes a special provision that, in the event of global crisis or civilization collapse, all copyright restrictions are suspended, making the knowledge freely available to all of humanity.

See the [LICENSE](./LICENSE) file for details.

---

<p align="center">
  <i>"The greatest glory of a building is not in its stones, nor in its gold. Its glory is in its endurance." - John Ruskin</i>
</p>
