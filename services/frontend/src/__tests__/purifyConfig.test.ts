/**
 * Tests for the DOMPurify configuration.
 * Verifies that XSS payloads are stripped while normal content is preserved.
 */

import DOMPurify from 'dompurify';
import { PURIFY_CONFIG } from '../utils/purifyConfig';

function sanitize(input: string): string {
  return DOMPurify.sanitize(input, PURIFY_CONFIG);
}

// ── XSS payloads are stripped ──

describe('PURIFY_CONFIG strips XSS payloads', () => {
  it('removes <script> tags', () => {
    const result = sanitize('<script>alert("xss")</script>');
    expect(result).not.toContain('<script');
    expect(result).not.toContain('</script>');
  });

  it('removes onerror attributes', () => {
    const result = sanitize('<img onerror="alert(1)" src="x">');
    expect(result).not.toContain('onerror');
  });

  it('removes onclick attributes', () => {
    const result = sanitize('<div onclick="alert(1)">click me</div>');
    expect(result).not.toContain('onclick');
  });

  it('removes onload attributes', () => {
    const result = sanitize('<body onload="alert(1)">content</body>');
    expect(result).not.toContain('onload');
  });

  it('removes onmouseover attributes', () => {
    const result = sanitize('<a onmouseover="alert(1)">hover</a>');
    expect(result).not.toContain('onmouseover');
  });

  it('removes style attributes', () => {
    const result = sanitize('<div style="background:url(evil)">text</div>');
    expect(result).not.toContain('style=');
  });

  it('removes <iframe> tags', () => {
    const result = sanitize('<iframe src="https://evil.com"></iframe>');
    expect(result).not.toContain('<iframe');
  });

  it('removes <object> tags', () => {
    const result = sanitize('<object data="evil.swf"></object>');
    expect(result).not.toContain('<object');
  });

  it('removes <embed> tags', () => {
    const result = sanitize('<embed src="evil.swf">');
    expect(result).not.toContain('<embed');
  });

  it('removes <form> tags', () => {
    const result = sanitize('<form action="https://evil.com"><input type="text"></form>');
    expect(result).not.toContain('<form');
    expect(result).not.toContain('<input');
  });

  it('removes <style> tags', () => {
    const result = sanitize('<style>body{display:none}</style>');
    expect(result).not.toContain('<style');
  });

  it('removes data attributes', () => {
    const result = sanitize('<div data-exploit="payload">text</div>');
    expect(result).not.toContain('data-exploit');
  });

  it('strips javascript: href', () => {
    // DOMPurify strips javascript: protocol from href
    const result = sanitize('<a href="javascript:alert(1)">click</a>');
    expect(result).not.toContain('javascript:');
  });
});

// ── Normal content is preserved ──

describe('PURIFY_CONFIG preserves normal content', () => {
  it('preserves plain text', () => {
    expect(sanitize('Hello, World!')).toBe('Hello, World!');
  });

  it('preserves <b> tags', () => {
    expect(sanitize('<b>bold</b>')).toBe('<b>bold</b>');
  });

  it('preserves <i> tags', () => {
    expect(sanitize('<i>italic</i>')).toBe('<i>italic</i>');
  });

  it('preserves <em> tags', () => {
    expect(sanitize('<em>emphasis</em>')).toBe('<em>emphasis</em>');
  });

  it('preserves <strong> tags', () => {
    expect(sanitize('<strong>strong</strong>')).toBe('<strong>strong</strong>');
  });

  it('preserves <a> with href and target', () => {
    const input = '<a href="https://example.com" target="_blank">link</a>';
    const result = sanitize(input);
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('target="_blank"');
    expect(result).toContain('>link</a>');
  });

  it('preserves <code> tags', () => {
    expect(sanitize('<code>const x = 1;</code>')).toBe('<code>const x = 1;</code>');
  });

  it('preserves <pre> tags', () => {
    expect(sanitize('<pre>preformatted</pre>')).toBe('<pre>preformatted</pre>');
  });

  it('preserves <br> tags', () => {
    expect(sanitize('line1<br>line2')).toBe('line1<br>line2');
  });

  it('preserves <ul> and <li> tags', () => {
    const result = sanitize('<ul><li>item</li></ul>');
    expect(result).toContain('<ul>');
    expect(result).toContain('<li>');
  });

  it('preserves <ol> and <li> tags', () => {
    const result = sanitize('<ol><li>first</li></ol>');
    expect(result).toContain('<ol>');
    expect(result).toContain('<li>');
  });

  it('preserves <blockquote> tags', () => {
    expect(sanitize('<blockquote>quote</blockquote>')).toBe('<blockquote>quote</blockquote>');
  });

  it('preserves <p> tags', () => {
    expect(sanitize('<p>paragraph</p>')).toBe('<p>paragraph</p>');
  });
});

// ── Mixed content (safe + dangerous) ──

describe('PURIFY_CONFIG handles mixed content', () => {
  it('strips script but keeps surrounding text', () => {
    const result = sanitize('before<script>alert(1)</script>after');
    expect(result).toBe('beforeafter');
  });

  it('strips dangerous attributes but keeps the tag content', () => {
    const result = sanitize('<b onclick="alert(1)">bold text</b>');
    expect(result).toBe('<b>bold text</b>');
  });

  it('preserves valid href but strips event handlers on <a>', () => {
    const result = sanitize('<a href="https://safe.com" onclick="evil()">link</a>');
    expect(result).toContain('href="https://safe.com"');
    expect(result).not.toContain('onclick');
  });
});
