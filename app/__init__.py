"""ResumeAI demo app package.

This file is load-bearing: `streamlit run app/app.py` puts `app/` on sys.path, so
without it `import app` resolves to the app.py *module* (a regular module beats a
namespace package) and `app.explain` fails to import.
"""
