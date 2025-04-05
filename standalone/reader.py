#!/usr/bin/env python3

import json
import os
import re
import sys
import datetime
import glob
from typing import Dict, List, Any, Optional, Set


class ArchiveReader:
    """Command-line reader for WorldEndArchive JSON database files."""

    def __init__(self):
        self.database = {
            "pages": [],
            "page_topics": [],
            "settings": {},
            "crawl_queue": []
        }
        self.current_page = 1
        self.results_per_page = 10
        self.active_topics: Set[str] = set()
        self.search_query = ""
        self.filtered_results = []

    def load_file(self, file_path: str) -> bool:
        """Load a JSON archive file."""
        print(f"Loading {file_path}...")
        
        if not os.path.exists(file_path):
            print(f"Error: File '{file_path}' not found.")
            return False
        
        file_size = os.path.getsize(file_path)
        file_size_mb = file_size / (1024 * 1024)
        print(f"File size: {file_size_mb:.1f} MB")
        
        # For very large files, use the chunk-based approach
        if file_size_mb > 100:
            return self.load_large_file(file_path)
        
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                raw_data = f.read()
                
            # Try to load the entire file first
            try:
                self.database = json.loads(raw_data)
                print(f"Successfully loaded database with {len(self.database.get('pages', []))} pages.")
                self.verify_and_fix_structure()
                self.print_stats()
                return True
            except json.JSONDecodeError as e:
                print(f"Error parsing complete JSON: {str(e)}")
                print("Attempting to recover data...")
                
                # Try to extract JSON objects using regex
                self.extract_full_database(raw_data)
                
                if len(self.database.get("pages", [])) > 0:
                    print(f"Recovered {len(self.database['pages'])} pages from file.")
                    self.verify_and_fix_structure()
                    self.print_stats()
                    return True
                else:
                    # As a last resort, try chunk-based loading
                    return self.load_large_file(file_path)
        
        except Exception as e:
            print(f"Error loading file: {str(e)}")
            return self.load_large_file(file_path)

    def load_large_file(self, file_path: str) -> bool:
        """Load a large JSON file in chunks."""
        print("Using sequential loading method for large file...")
        
        # Reset the database
        self.database = {
            "pages": [],
            "page_topics": [],
            "settings": {},
            "crawl_queue": []
        }
        
        try:
            # First attempt: try to read the file structure without loading all content
            with open(file_path, 'r', encoding='utf-8') as f:
                # Read first chunk to detect file structure
                start_chunk = f.read(1024 * 50)  # Read first 50KB
                
                # Check if it starts as a JSON object
                if start_chunk.strip().startswith('{'):
                    # Look for the "pages" array start
                    pages_pos = start_chunk.find('"pages"')
                    if pages_pos > 0:
                        print("Detected standard JSON structure with 'pages' array.")
                        return self.process_structured_json(file_path)
                    
            # Second attempt: full incremental parsing
            return self.process_unstructured_json(file_path)
            
        except Exception as e:
            print(f"Error during file processing: {str(e)}")
            return False

    def process_structured_json(self, file_path: str) -> bool:
        """Process a file that has a standard JSON structure with pages array."""
        try:
            file_size = os.path.getsize(file_path)
            
            with open(file_path, 'r', encoding='utf-8') as f:
                # Parse the opening brace and any metadata before pages array
                buffer = ""
                in_pages_array = False
                pages_count = 0
                chunk_size = 10 * 1024 * 1024  # 10MB chunks
                processed_bytes = 0
                
                # Process the file in chunks
                while True:
                    chunk = f.read(chunk_size)
                    if not chunk:
                        break
                    
                    buffer += chunk
                    processed_bytes += len(chunk)
                    percent = (processed_bytes / file_size) * 100
                    
                    print(f"\rProcessing: {percent:.1f}% complete... ({pages_count} pages found)", end="")
                    
                    # If we haven't found the pages array yet, look for it
                    if not in_pages_array:
                        pages_pos = buffer.find('"pages":')
                        if pages_pos >= 0:
                            # Found the start of pages array
                            array_start = buffer.find('[', pages_pos)
                            if array_start >= 0:
                                in_pages_array = True
                                buffer = buffer[array_start + 1:]  # Keep everything after the opening bracket
                                
                    # Now we're in the pages array, extract complete objects
                    while in_pages_array:
                        # Look for a complete JSON object
                        depth = 0
                        in_quotes = False
                        escape_next = False
                        obj_start = buffer.find('{')
                        
                        if obj_start < 0:
                            break  # No objects in buffer
                        
                        # Find the matching closing brace
                        for i in range(obj_start, len(buffer)):
                            char = buffer[i]
                            
                            if escape_next:
                                escape_next = False
                                continue
                                
                            if char == '\\':
                                escape_next = True
                                continue
                                
                            if char == '"' and not escape_next:
                                in_quotes = not in_quotes
                                continue
                                
                            if not in_quotes:
                                if char == '{':
                                    depth += 1
                                elif char == '}':
                                    depth -= 1
                                    if depth == 0:
                                        # We found a complete object
                                        try:
                                            obj_text = buffer[obj_start:i+1]
                                            page_obj = json.loads(obj_text)
                                            if self.is_valid_page(page_obj):
                                                if not any(p.get('url') == page_obj.get('url') for p in self.database["pages"]):
                                                    self.database["pages"].append(page_obj)
                                                    pages_count += 1
                                        except json.JSONDecodeError:
                                            pass  # Skip invalid objects
                                        
                                        # Remove processed object from buffer
                                        buffer = buffer[i+1:]
                                        
                                        # Check if we're at the end of the array
                                        if buffer.lstrip().startswith(']'):
                                            in_pages_array = False
                                            # Try to extract settings and other arrays
                                            self.extract_other_data(buffer)
                                            break
                                        
                                        # Look for the next object
                                        break
                        
                        # If we didn't close an object, break and get more data
                        if depth != 0:
                            break
                            
                    # If we've reached the end of the array, no need to continue
                    if not in_pages_array:
                        break
                    
                    # Limit buffer size to prevent memory issues
                    if len(buffer) > 20 * 1024 * 1024:  # 20MB max buffer
                        buffer = buffer[-5 * 1024 * 1024:]  # Keep last 5MB
                
                print("\nProcessing complete.")
                
                if len(self.database["pages"]) > 0:
                    print(f"Successfully loaded {len(self.database['pages'])} pages.")
                    self.verify_and_fix_structure()
                    self.print_stats()
                    return True
                else:
                    # Fall back to unstructured parsing
                    return self.process_unstructured_json(file_path)
                
        except Exception as e:
            print(f"\nError during structured parsing: {str(e)}")
            return self.process_unstructured_json(file_path)

    def process_unstructured_json(self, file_path: str) -> bool:
        """Process file as unstructured JSON, extracting objects with regex."""
        print("\nAttempting unstructured extraction of JSON objects...")
        
        chunk_size = 5 * 1024 * 1024  # 5MB chunks
        file_size = os.path.getsize(file_path)
        processed = 0
        buffer = ""
        
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                while True:
                    chunk = f.read(chunk_size)
                    if not chunk:
                        break
                    
                    buffer += chunk
                    processed += len(chunk)
                    percent = (processed / file_size) * 100
                    
                    print(f"\rProcessing: {percent:.1f}% complete... ({len(self.database['pages'])} pages found)", end="")
                    
                    # Extract complete objects
                    self.extract_objects(buffer)
                    
                    # Keep only the last part of the buffer to handle objects split across chunks
                    if len(buffer) > 20000:
                        buffer = buffer[-20000:]
            
            print("\nUnstructured processing complete.")
            
            # Final pass to extract anything from the remaining buffer
            self.extract_objects(buffer)
            
            # If we still have no pages, try even more aggressive recovery
            if len(self.database["pages"]) == 0:
                print("Attempting deep recovery of page data...")
                self.recover_basic_pages(buffer)
            
            if len(self.database["pages"]) > 0:
                print(f"Successfully recovered {len(self.database['pages'])} pages.")
                self.verify_and_fix_structure()
                self.print_stats()
                return True
            else:
                print("Error: Could not extract any valid pages from the file.")
                return False
        
        except Exception as e:
            print(f"\nError during unstructured processing: {str(e)}")
            return False

    def extract_full_database(self, text: str) -> None:
        """Attempt to extract full database structure from text."""
        # Look for database object wrapper
        db_match = re.search(r'\{[\s\S]*?"pages"\s*:\s*\[[\s\S]*?\][\s\S]*?\}', text)
        if db_match:
            try:
                db_json = db_match.group(0)
                db_obj = json.loads(db_json)
                if isinstance(db_obj, dict) and "pages" in db_obj:
                    self.database = db_obj
                    return
            except json.JSONDecodeError:
                pass
        
        # If that fails, extract individual arrays
        # Extract pages array
        pages_match = re.search(r'"pages"\s*:\s*(\[[\s\S]*?\])', text)
        if pages_match:
            try:
                pages_json = pages_match.group(1)
                pages_list = json.loads(pages_json)
                if isinstance(pages_list, list):
                    self.database["pages"] = pages_list
            except json.JSONDecodeError:
                # If we can't parse the whole array, try individual objects
                self.extract_objects(text)
        else:
            # If no pages array is found, try individual objects
            self.extract_objects(text)
        
        # Extract topics array
        topics_match = re.search(r'"page_topics"\s*:\s*(\[[\s\S]*?\])', text)
        if topics_match:
            try:
                topics_json = topics_match.group(1)
                topics_list = json.loads(topics_json)
                if isinstance(topics_list, list):
                    self.database["page_topics"] = topics_list
            except json.JSONDecodeError:
                pass
        
        # Extract settings
        settings_match = re.search(r'"settings"\s*:\s*(\{[\s\S]*?\})', text)
        if settings_match:
            try:
                settings_json = settings_match.group(1)
                settings_obj = json.loads(settings_json)
                if isinstance(settings_obj, dict):
                    self.database["settings"] = settings_obj
            except json.JSONDecodeError:
                pass

    def extract_other_data(self, text: str) -> None:
        """Extract settings, topics, and other data from remaining text."""
        # This is called after processing the pages array to extract other parts
        
        # Extract page_topics array
        topics_match = re.search(r'"page_topics"\s*:\s*(\[[\s\S]*?\])', text)
        if topics_match:
            try:
                topics_start = topics_match.start(1)
                # Parse the array manually to handle large arrays
                depth = 0
                in_quotes = False
                escape_next = False
                
                for i in range(topics_start, len(text)):
                    char = text[i]
                    
                    if escape_next:
                        escape_next = False
                        continue
                        
                    if char == '\\':
                        escape_next = True
                        continue
                        
                    if char == '"' and not escape_next:
                        in_quotes = not in_quotes
                        continue
                        
                    if not in_quotes:
                        if char == '[':
                            depth += 1
                        elif char == ']':
                            depth -= 1
                            if depth == 0:
                                # Found the end of the array
                                try:
                                    topics_json = text[topics_start:i+1]
                                    # Try to load the whole array first
                                    try:
                                        topics_list = json.loads(topics_json)
                                        if isinstance(topics_list, list):
                                            self.database["page_topics"] = topics_list
                                    except json.JSONDecodeError:
                                        # If that fails, extract individual topics
                                        self.extract_topics(topics_json)
                                except Exception:
                                    pass
                                break
            except Exception:
                pass
        
        # Extract settings
        settings_match = re.search(r'"settings"\s*:\s*(\{[\s\S]*?\})', text)
        if settings_match:
            try:
                settings_json = settings_match.group(1)
                settings_obj = json.loads(settings_json)
                if isinstance(settings_obj, dict):
                    self.database["settings"] = settings_obj
            except Exception:
                pass

    def verify_and_fix_structure(self) -> None:
        """Verify database structure and fix missing elements."""
        if not isinstance(self.database, dict):
            self.database = {"pages": [], "page_topics": [], "settings": {}, "crawl_queue": []}
            return
        
        # Ensure basic structure exists
        if "pages" not in self.database:
            self.database["pages"] = []
        
        if "page_topics" not in self.database:
            self.database["page_topics"] = []
        
        if "settings" not in self.database:
            self.database["settings"] = {}
        
        if "crawl_queue" not in self.database:
            self.database["crawl_queue"] = []
        
        # Ensure pages have required properties
        for page in self.database["pages"]:
            if not isinstance(page, dict):
                continue
            
            if "id" not in page and "url" in page:
                # Generate an ID if missing
                page["id"] = hash(page["url"]) % 10000000
            
            if "title" not in page:
                page["title"] = "Untitled"
            
            if "date_archived" not in page:
                page["date_archived"] = datetime.datetime.now().isoformat()
        
        # Fix page_topics relationships
        valid_topics = []
        page_ids = {p.get("id") for p in self.database["pages"] if p.get("id")}
        
        for topic in self.database["page_topics"]:
            if not isinstance(topic, dict):
                continue
            
            if "topic" not in topic or "page_id" not in topic:
                continue
            
            # Ensure the page_id exists in pages
            if topic["page_id"] in page_ids:
                valid_topics.append(topic)
        
        self.database["page_topics"] = valid_topics

    def extract_objects(self, text: str) -> None:
        """Extract JSON objects from text."""
        # Look for page objects - improved pattern that matches most JSON page objects
        page_pattern = re.compile(r'\{\s*"(?:id|url|title|html_content|date_archived|description)[\s\S]*?(?:"(?:id|url|title|html_content|date_archived|description)"[\s\S]*?){1,}?\}')
        for match in page_pattern.finditer(text):
            try:
                page_json = match.group(0)
                if '"url"' in page_json or '"title"' in page_json or '"html_content"' in page_json:
                    page_obj = json.loads(self.cleanup_json(page_json))
                    if self.is_valid_page(page_obj):
                        # Check if we already have this page
                        if not any(p.get('url') == page_obj.get('url') or 
                                   (p.get('id') and p.get('id') == page_obj.get('id'))
                                   for p in self.database["pages"]):
                            self.database["pages"].append(page_obj)
            except json.JSONDecodeError:
                continue
            except Exception:
                continue
        
        # Look for topic objects - improved pattern
        topic_pattern = re.compile(r'\{\s*"(?:id|topic|page_id)[\s\S]*?(?:"(?:id|topic|page_id)"[\s\S]*?){1,}?\}')
        for match in topic_pattern.finditer(text):
            try:
                topic_json = match.group(0)
                if '"topic"' in topic_json and '"page_id"' in topic_json:
                    topic_obj = json.loads(self.cleanup_json(topic_json))
                    if 'topic' in topic_obj and 'page_id' in topic_obj:
                        # Check for duplicates
                        is_duplicate = any(
                            t.get('topic') == topic_obj.get('topic') and 
                            t.get('page_id') == topic_obj.get('page_id')
                            for t in self.database["page_topics"]
                        )
                        if not is_duplicate:
                            self.database["page_topics"].append(topic_obj)
            except Exception:
                continue
        
        # Try to extract settings
        settings_match = re.search(r'"settings"\s*:\s*(\{[\s\S]*?\})', text)
        if settings_match:
            try:
                settings_json = settings_match.group(1)
                settings_obj = json.loads(self.cleanup_json(settings_json))
                if isinstance(settings_obj, dict):
                    # Merge with existing settings
                    self.database["settings"].update(settings_obj)
            except Exception:
                pass

    def extract_topics(self, text: str) -> None:
        """Extract individual topic objects from topics array text."""
        topic_pattern = re.compile(r'\{\s*"(?:id|topic|page_id)[\s\S]*?(?:"(?:id|topic|page_id)"[\s\S]*?){1,}?\}')
        for match in topic_pattern.finditer(text):
            try:
                topic_json = match.group(0)
                if '"topic"' in topic_json and '"page_id"' in topic_json:
                    topic_obj = json.loads(self.cleanup_json(topic_json))
                    if 'topic' in topic_obj and 'page_id' in topic_obj:
                        # Check for duplicates
                        is_duplicate = any(
                            t.get('topic') == topic_obj.get('topic') and 
                            t.get('page_id') == topic_obj.get('page_id')
                            for t in self.database["page_topics"]
                        )
                        if not is_duplicate:
                            self.database["page_topics"].append(topic_obj)
            except Exception:
                continue

    def cleanup_json(self, json_str: str) -> str:
        """Clean up potentially malformed JSON."""
        # Fix common JSON issues
        json_str = json_str.replace("'", '"')  # Replace single quotes with double quotes
        json_str = re.sub(r',\s*(\}|\])', r'\1', json_str)  # Remove trailing commas
        json_str = re.sub(r'([{,]\s*)([a-zA-Z0-9_]+)(\s*:)', r'\1"\2"\3', json_str)  # Ensure property names are quoted
        return json_str

    def is_valid_page(self, page_obj: Dict) -> bool:
        """Check if a page object has the required properties."""
        return (isinstance(page_obj, dict) and 
                ('url' in page_obj or 'title' in page_obj or 'id' in page_obj))

    def recover_basic_pages(self, text: str) -> None:
        """Attempt to recover basic page information."""
        # Look for URLs and create simple page objects
        url_pattern = re.compile(r'"url"\s*:\s*"([^"]+)"')
        url_matches = list(url_pattern.finditer(text))
        
        if url_matches:
            print(f"Found {len(url_matches)} URLs but couldn't parse full pages. Creating simplified pages.")
            
            for i, match in enumerate(url_matches):
                url = match.group(1)
                
                # Skip if we already have this URL
                if any(p.get('url') == url for p in self.database["pages"]):
                    continue
                
                # Try to find a title near this URL
                context_start = max(0, match.start() - 500)
                context_end = min(len(text), match.end() + 500)
                context = text[context_start:context_end]
                
                title = "Unknown"
                title_match = re.search(r'"title"\s*:\s*"([^"]+)"', context)
                if title_match:
                    title = title_match.group(1)
                
                description = "Recovered from partially corrupt data"
                desc_match = re.search(r'"description"\s*:\s*"([^"]+)"', context)
                if desc_match:
                    description = desc_match.group(1)
                
                self.database["pages"].append({
                    "id": i + 1,
                    "url": url,
                    "title": title,
                    "description": description,
                    "date_archived": datetime.datetime.now().isoformat()
                })

    def print_stats(self) -> None:
        """Print database statistics."""
        # Count unique topics
        unique_topics = set()
        for topic_rel in self.database.get("page_topics", []):
            if isinstance(topic_rel, dict) and topic_rel.get("topic"):
                unique_topics.add(topic_rel["topic"])
        
        # Alternative way to get topics from pages themselves
        for page in self.database.get("pages", []):
            if isinstance(page, dict) and page.get("topics"):
                if isinstance(page["topics"], str):
                    page_topics = [t.strip() for t in page["topics"].split(",") if t.strip()]
                    unique_topics.update(page_topics)
                elif isinstance(page["topics"], list):
                    unique_topics.update(page["topics"])
        
        stats = [
            f"Total Pages: {len(self.database.get('pages', []))}",
            f"Topics: {len(unique_topics)}",
            f"Queue Size: {len(self.database.get('crawl_queue', []))}"
        ]
        
        # Calculate content size if not available in settings
        if not self.database.get("settings", {}).get("total_size_raw"):
            total_size = 0
            for page in self.database.get("pages", []):
                if isinstance(page, dict) and page.get("html_content"):
                    total_size += len(page["html_content"].encode('utf-8'))
            
            if total_size > 0:
                self.database.setdefault("settings", {})["total_size_raw"] = total_size
        
        if self.database.get("settings", {}).get("total_size_raw"):
            try:
                size = int(self.database["settings"]["total_size_raw"])
                stats.append(f"Content Size: {self.format_bytes(size)}")
            except (ValueError, TypeError):
                # Try to handle string values
                try:
                    size_str = str(self.database["settings"]["total_size_raw"])
                    size = int(size_str)
                    stats.append(f"Content Size: {self.format_bytes(size)}")
                except (ValueError, TypeError):
                    pass
        
        if self.database.get("settings", {}).get("last_crawl_date"):
            stats.append(f"Last Crawl: {self.database['settings']['last_crawl_date']}")
        
        print("\n=== ARCHIVE STATISTICS ===")
        for stat in stats:
            print(stat)
        print("=========================\n")

    def format_bytes(self, size: int) -> str:
        """Format bytes to human-readable format."""
        for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
            if size < 1024.0:
                return f"{size:.1f} {unit}"
            size /= 1024.0
        return f"{size:.1f} PB"

    def get_unique_topics(self) -> List[str]:
        """Get a list of all unique topics in the database."""
        topics = set()
        
        # Check for direct topics in pages
        for page in self.database.get("pages", []):
            if page.get("topics"):
                page_topics = [t.strip() for t in page["topics"].split(",") if t.strip()]
                topics.update(page_topics)
        
        # Check for topics in page_topics relation
        for topic_rel in self.database.get("page_topics", []):
            if topic_rel.get("topic"):
                topics.add(topic_rel["topic"])
        
        return sorted(list(topics))

    def get_page_topics(self, page: Dict) -> List[str]:
        """Get topics for a specific page."""
        topics = []
        
        # Check direct topics property
        if page.get("topics"):
            topics = [t.strip() for t in page["topics"].split(",") if t.strip()]
        
        # Check page_topics relation
        elif self.database.get("page_topics"):
            page_id = page.get("id")
            if page_id:
                topics = [
                    t["topic"] for t in self.database["page_topics"]
                    if t.get("page_id") == page_id and t.get("topic")
                ]
        
        return topics

    def search(self) -> None:
        """Search for pages based on query and active topics."""
        results = self.database.get("pages", [])[:]
        
        # Apply topic filters
        if self.active_topics:
            filtered_results = []
            for page in results:
                page_topics = self.get_page_topics(page)
                if all(topic in page_topics for topic in self.active_topics):
                    filtered_results.append(page)
            results = filtered_results
        
        # Apply text search
        if self.search_query:
            query_lower = self.search_query.lower()
            filtered_results = []
            for page in results:
                if (
                    (page.get("title") and query_lower in page["title"].lower()) or
                    (page.get("url") and query_lower in page["url"].lower()) or
                    (page.get("description") and query_lower in page["description"].lower())
                ):
                    filtered_results.append(page)
            results = filtered_results
        
        # Sort by date (newest first)
        results.sort(
            key=lambda p: p.get("date_archived", ""),
            reverse=True
        )
        
        self.filtered_results = results
        self.current_page = 1
        self.display_results()

    def display_results(self) -> None:
        """Display the current page of search results."""
        if not self.filtered_results:
            print("\nNo results found.")
            return
        
        total_results = len(self.filtered_results)
        total_pages = (total_results + self.results_per_page - 1) // self.results_per_page
        
        start_idx = (self.current_page - 1) * self.results_per_page
        end_idx = min(start_idx + self.results_per_page, total_results)
        
        print(f"\n=== RESULTS (Page {self.current_page}/{total_pages}, {total_results} items) ===\n")
        
        for i, page in enumerate(self.filtered_results[start_idx:end_idx], 1):
            idx = start_idx + i
            title = page.get("title", "Untitled")
            url = page.get("url", "")
            date = page.get("date_archived", "")
            topics = self.get_page_topics(page)
            
            print(f"{idx}. \033[1;33m{title}\033[0m")
            print(f"   URL: {url}")
            if date:
                try:
                    date_obj = datetime.datetime.fromisoformat(date.replace('Z', '+00:00'))
                    print(f"   Date: {date_obj.strftime('%Y-%m-%d')}")
                except ValueError:
                    print(f"   Date: {date}")
            
            if topics:
                print(f"   Topics: {', '.join(topics)}")
            print()
        
        print(f"Page {self.current_page}/{total_pages}")

    def view_page(self, index: int) -> None:
        """View a specific page from the search results."""
        if not self.filtered_results:
            print("No results to view.")
            return
        
        if index < 1 or index > len(self.filtered_results):
            print(f"Invalid index. Please enter a number between 1 and {len(self.filtered_results)}.")
            return
        
        page = self.filtered_results[index - 1]
        
        title = page.get("title", "Untitled")
        url = page.get("url", "")
        desc = page.get("description", "")
        date = page.get("date_archived", "")
        topics = self.get_page_topics(page)
        
        print("\n" + "=" * 60)
        print(f"\033[1;33m{title}\033[0m")
        print("=" * 60)
        print(f"URL: {url}")
        
        if date:
            try:
                date_obj = datetime.datetime.fromisoformat(date.replace('Z', '+00:00'))
                print(f"Date Archived: {date_obj.strftime('%Y-%m-%d %H:%M:%S')}")
            except ValueError:
                print(f"Date Archived: {date}")
        
        if topics:
            print(f"Topics: {', '.join(topics)}")
        
        print("\nDescription:")
        print(desc if desc else "No description available.")
        
        # Check if HTML content is available
        if page.get("html_content"):
            print("\nHTML content is available. Would you like to:")
            print("1. Save HTML to file")
            print("2. View raw HTML (truncated)")
            print("3. Return to results")
            
            choice = input("Enter your choice (1-3): ")
            
            if choice == "1":
                self.save_html_to_file(page)
            elif choice == "2":
                html = page.get("html_content", "")
                print("\n--- HTML CONTENT (truncated) ---")
                print(html[:1000] + ("..." if len(html) > 1000 else ""))
                print("--- END OF PREVIEW ---")
        
        print("\nPress Enter to return to results...")
        input()

    def save_html_to_file(self, page: Dict) -> None:
        """Save page HTML content to a file."""
        if not page.get("html_content"):
            print("No HTML content available to save.")
            return
        
        # Create a safe filename from the page title
        title = page.get("title", "untitled")
        safe_filename = re.sub(r'[^\w\s-]', '', title).strip().lower()
        safe_filename = re.sub(r'[-\s]+', '-', safe_filename)
        
        # Add URL domain to filename to avoid duplicates
        url = page.get("url", "")
        if url:
            try:
                from urllib.parse import urlparse
                domain = urlparse(url).netloc
                if domain:
                    safe_filename = f"{domain}_{safe_filename}"
            except Exception:
                pass
        
        filename = f"{safe_filename}.html"
        
        try:
            with open(filename, 'w', encoding='utf-8') as f:
                f.write(page["html_content"])
            print(f"HTML content saved to: {filename}")
        except Exception as e:
            print(f"Error saving HTML file: {str(e)}")

    def find_json_files(self) -> List[str]:
        """Find all JSON files in the current directory."""
        return glob.glob("*.json")

    def run(self) -> None:
        """Main application loop."""
        file_path = None
        
        # First check if a file path is provided as argument
        if len(sys.argv) > 1:
            file_path = sys.argv[1]
        else:
            # Look for JSON files in the current directory
            json_files = self.find_json_files()
            
            if len(json_files) == 0:
                print("No JSON files found in the current directory.")
                file_path = input("Enter the path to your WorldEndArchive JSON file: ")
            elif len(json_files) == 1:
                file_path = json_files[0]
                print(f"Found archive file: {file_path}")
            else:
                print("Multiple JSON files found in the current directory:")
                for i, file_name in enumerate(json_files, 1):
                    file_size = os.path.getsize(file_name) / (1024 * 1024)  # Size in MB
                    print(f"{i}. {file_name} ({file_size:.1f} MB)")
                
                choice = input("\nEnter the number of the file to use (or press Enter to specify a different path): ")
                if choice.isdigit() and 1 <= int(choice) <= len(json_files):
                    file_path = json_files[int(choice) - 1]
                else:
                    file_path = input("Enter the path to your WorldEndArchive JSON file: ")
        
        if not file_path:
            print("No file provided. Exiting.")
            return
        
        if not self.load_file(file_path):
            print("Please provide a valid WorldEndArchive JSON file.")
            return
        
        while True:
            print("\n=== WORLDENDARCHIVE READER ===")
            print("1. Search")
            print("2. Browse by Topic")
            print("3. View Statistics")
            print("4. Exit")
            
            choice = input("\nEnter your choice (1-4): ")
            
            if choice == "1":
                self.search_menu()
            elif choice == "2":
                self.topic_menu()
            elif choice == "3":
                self.print_stats()
                input("Press Enter to continue...")
            elif choice == "4":
                print("Exiting the WorldEndArchive Reader. Goodbye!")
                break
            else:
                print("Invalid choice. Please try again.")

    def search_menu(self) -> None:
        """Display search interface."""
        self.search_query = input("\nEnter search query (or press Enter to see all pages): ")
        
        # Display active topics
        if self.active_topics:
            print(f"Active topic filters: {', '.join(self.active_topics)}")
        
        self.search()
        
        while True:
            print("\nOptions:")
            print("1. View a specific result")
            print("2. Next page")
            print("3. Previous page")
            print("4. New search")
            print("5. Back to main menu")
            
            choice = input("\nEnter your choice (1-5): ")
            
            if choice == "1":
                try:
                    index = int(input("Enter the number of the result to view: "))
                    self.view_page(index)
                except ValueError:
                    print("Please enter a valid number.")
            elif choice == "2":
                total_pages = (len(self.filtered_results) + self.results_per_page - 1) // self.results_per_page
                if self.current_page < total_pages:
                    self.current_page += 1
                    self.display_results()
                else:
                    print("You are already on the last page.")
            elif choice == "3":
                if self.current_page > 1:
                    self.current_page -= 1
                    self.display_results()
                else:
                    print("You are already on the first page.")
            elif choice == "4":
                return self.search_menu()
            elif choice == "5":
                return
            else:
                print("Invalid choice. Please try again.")

    def topic_menu(self) -> None:
        """Display topic selection interface."""
        topics = self.get_unique_topics()
        
        if not topics:
            print("No topics found in the database.")
            input("Press Enter to continue...")
            return
        
        while True:
            print("\n=== TOPICS ===")
            for i, topic in enumerate(topics, 1):
                active = topic in self.active_topics
                status = "\033[1;32m[ACTIVE]\033[0m" if active else ""
                print(f"{i}. {topic} {status}")
            
            print("\nOptions:")
            print("1. Toggle topic filter")
            print("2. Clear all filters")
            print("3. Search with current filters")
            print("4. Back to main menu")
            
            choice = input("\nEnter your choice (1-4): ")
            
            if choice == "1":
                try:
                    index = int(input("Enter the number of the topic to toggle: "))
                    if 1 <= index <= len(topics):
                        topic = topics[index - 1]
                        if topic in self.active_topics:
                            self.active_topics.remove(topic)
                            print(f"Removed filter: {topic}")
                        else:
                            self.active_topics.add(topic)
                            print(f"Added filter: {topic}")
                    else:
                        print(f"Please enter a number between 1 and {len(topics)}.")
                except ValueError:
                    print("Please enter a valid number.")
            elif choice == "2":
                self.active_topics.clear()
                print("All topic filters have been cleared.")
            elif choice == "3":
                self.search()
                return
            elif choice == "4":
                return
            else:
                print("Invalid choice. Please try again.")


if __name__ == "__main__":
    try:
        reader = ArchiveReader()
        reader.run()
    except KeyboardInterrupt:
        print("\nProgram terminated by user. Goodbye!")
    except Exception as e:
        print(f"An unexpected error occurred: {str(e)}") 