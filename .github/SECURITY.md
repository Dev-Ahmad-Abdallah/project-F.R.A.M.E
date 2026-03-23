# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 1.x     | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in F.R.A.M.E., please report it responsibly:

1. **Do NOT open a public GitHub issue.**
2. Email: **dev.ahmed.abdallah@gmail.com**
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Impact assessment
   - Suggested fix (if any)

We aim to respond within **48 hours** and provide a fix within **7 days** for critical issues.

## Security Measures

F.R.A.M.E. implements multiple layers of security:

- **End-to-end encryption** via Olm/Megolm (vodozemac WASM)
- **Automated security scanning** via CodeQL, Trivy, Semgrep, and Gitleaks
- **Dependency monitoring** via Dependabot
- **Container scanning** on every build
- **Rate limiting** on all API endpoints
- **Input validation** via Zod schemas on every request
- **XSS prevention** via DOMPurify with strict configuration
- **CSRF protection** via Bearer-token authentication (no cookies)

## Disclosure Timeline

- **Day 0**: Vulnerability reported
- **Day 1-2**: Acknowledgment sent
- **Day 3-7**: Fix developed and tested
- **Day 7-14**: Fix deployed to production
- **Day 30**: Public disclosure (if agreed with reporter)
