import os
import sys
import subprocess



if __name__ == "__main__":
    # Run the application on localhost
    docs_dir = os.path.join(os.path.dirname(__file__), "docs")

    if not os.path.isdir(docs_dir):
        print(f"Docs directory not found: {docs_dir}")
    else:
        print(f"Serving {docs_dir} on http://localhost:8000 (press Ctrl+C to stop)")
        try:
            subprocess.run([sys.executable, "-m", "http.server", "8000"], cwd=docs_dir, check=True)
        except KeyboardInterrupt:
            print("Server stopped by user.")
        except subprocess.CalledProcessError as e:
            print("Server exited with error:", e)