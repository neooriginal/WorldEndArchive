# WorldEndArchive

<style>
body {
    font-family: 'Courier New', Courier, monospace;
    background-color: #0d1117;
    color: #c9d1d9;
    line-height: 1.6;
}
h1, h2, h3 {
    color: #58a6ff;
    border-bottom: 1px solid #30363d;
    padding-bottom: 0.3em;
}
a {
    color: #58a6ff;
    text-decoration: none;
}
a:hover {
    text-decoration: underline;
}
code {
    background-color: #161b22;
    padding: 0.2em 0.4em;
    border-radius: 3px;
}
.poetic-intro {
    font-style: italic;
    color: #8b949e;
    border-left: 3px solid #30363d;
    padding-left: 1em;
    margin: 2em 0;
}
</style>

<div class="poetic-intro">
    "When the lights go out and the signals fade,<br>
    And the silence of the void begins to wade,<br>
    This archive stands, a beacon in the night,<br>
    Preserving wisdom, keeping truth in sight.<br>
    For if the world should crumble, dust to dust,<br>
    In this digital vault, we place our trust."
</div>

## Overview

**WorldEndArchive** is a resilient, autonomous web crawler designed to preserve human knowledge in the face of catastrophe. It tirelessly traverses the web, capturing essential information and storing it in accessible formats for a post-internet world.

## Setup & Usage

<details>
<summary><strong>Setup Gatherer (The Crawler)</strong></summary>

The Gatherer traverses the web to collect data.

1.  **Navigate to directory**:
    ```bash
    cd gatherer
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Configure**:
    -   Copy `.env.example` to `.env`.
    -   Edit `.env` to set your proxies, concurrency, etc.

4.  **Start Crawling**:
    ```bash
    npm start
    ```
    -   **Dashboard**: [http://localhost:3000](http://localhost:3000)
    -   **Output**: Data is saved to `gatherer/output/`.

</details>

<details>
<summary><strong>Setup Client (The Reader)</strong></summary>

The Client allows you to browse the archived content offline.

1.  **Navigate to directory**:
    ```bash
    cd client
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Start Reader**:
    ```bash
    npm start
    ```
    -   **Interface**: [http://localhost:3001](http://localhost:3001)

</details>

## Configuration

Edit `gatherer/.env` to customize:
*   `MAX_CONCURRENCY`: Number of simultaneous requests.
*   `DELAY_BETWEEN_REQUESTS_MS`: Throttle speed.
*   `USE_PROXIES`: Enable/disable proxy rotation.
*   `KEYWORDS_FILE`: Path to your custom keywords.


## Contributing

If you are reading this, the internet is likely still operational. Feel free to contribute to the codebase to ensure it is ready for when it is not.

---

*Preserving the past, for the future.*
