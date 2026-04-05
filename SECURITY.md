# Security Policy

## Threat Model Summary
The Gemini Token Tracker extension processes user prompts and API keys. Our primary security boundaries are:
1. Keeping API keys out of plaintext transmission (query strings) and insecure storage (`localStorage`).
2. Preventing unauthorized remote code execution or DOM-based XSS via injected UI elements.

## Supported Versions
Only the latest version of the extension on the `main` branch is supported for security updates.

## Reporting a Vulnerability
Do NOT open public issues for security vulnerabilities. 
Please report them privately by emailing rishabhkakkar571@gmail.com. We aim to acknowledge reports within 48 hours.
