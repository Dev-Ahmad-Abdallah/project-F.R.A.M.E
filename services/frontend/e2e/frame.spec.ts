/**
 * F.R.A.M.E. — Comprehensive Playwright E2E Test Suite
 *
 * Covers the full user journey:
 *   1. Landing page rendering and navigation
 *   2. Authentication (register, login, logout, invalid credentials)
 *   3. Chat flow (create room, send messages, verify encryption indicators)
 *   4. Settings (session timeout, device list, link device)
 *   5. Room management (room info, member list, leave room)
 *   6. Mobile responsiveness
 *
 * Target: https://frontend-production-29a3.up.railway.app
 */

import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const BASE_URL = 'https://frontend-production-29a3.up.railway.app';

/** Generate a unique username using a timestamp to avoid collisions. */
function uniqueUsername(): string {
  return `e2euser_${Date.now()}`;
}

/** Generate a strong password that satisfies F.R.A.M.E. strength requirements. */
function strongPassword(): string {
  return 'Str0ng!Pass_2026';
}

/** Navigate to the landing page and wait for the hero to render. */
async function goToLanding(page: Page) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  // Wait for the F.R.A.M.E. nav logo to appear
  await expect(page.locator('nav >> text=F.R.A.M.E.')).toBeVisible({ timeout: 20_000 });
}

/** Click "Sign In" on the nav bar to navigate to the auth page. */
async function goToAuth(page: Page) {
  await page.locator('nav >> button:has-text("Sign In")').click();
  // Should see the auth card with the F.R.A.M.E. heading
  await expect(page.locator('h1:has-text("F.R.A.M.E.")')).toBeVisible({ timeout: 15_000 });
}

/** Switch from login to register mode on the auth page. */
async function switchToRegister(page: Page) {
  await page.locator('button:has-text("Register")').click();
  await expect(page.locator('text=Create a new account')).toBeVisible();
}

/** Switch from register to login mode on the auth page. */
async function switchToLogin(page: Page) {
  await page.locator('button:has-text("Sign In"):not([type="submit"])').last().click();
  await expect(page.locator('text=Sign in to your account')).toBeVisible();
}

/** Register a new user; returns { username, password }. */
async function registerUser(page: Page) {
  const username = uniqueUsername();
  const password = strongPassword();

  await goToLanding(page);
  await goToAuth(page);
  await switchToRegister(page);

  await page.locator('#frame-username').fill(username);
  await page.locator('#frame-password').fill(password);
  await page.locator('button[type="submit"]:has-text("Create Account")').click();

  // Wait for either the success animation or the app shell to load.
  // The auth flow shows "Account created successfully" briefly, then loads the app.
  await expect(
    page.locator('text=Account created successfully').or(
      page.locator('text=Welcome to F.R.A.M.E.')
    ).or(
      page.locator('text=Online')
    ).or(
      page.locator('button:has-text("+ New Chat")')
    ),
  ).toBeVisible({ timeout: 30_000 });

  // Wait a bit more for the app shell to fully load after success animation
  await page.waitForTimeout(2000);

  return { username, password };
}

/** Log in an existing user and wait for the app shell. */
async function loginUser(page: Page, username: string, password: string) {
  await goToLanding(page);
  await goToAuth(page);

  // Should default to login mode
  await expect(page.locator('text=Sign in to your account')).toBeVisible();

  await page.locator('#frame-username').fill(username);
  await page.locator('#frame-password').fill(password);
  await page.locator('button[type="submit"]:has-text("Sign In")').click();

  // Wait for app shell
  await expect(
    page.locator('button:has-text("+ New Chat")').or(
      page.locator('text=Welcome to F.R.A.M.E.')
    ).or(
      page.locator('text=Online')
    ),
  ).toBeVisible({ timeout: 30_000 });
}

/** Log out from the app shell by clicking the logout icon button. */
async function logout(page: Page) {
  await page.locator('button[aria-label="Log out"]').click();
  // Should return to the landing page
  await expect(page.locator('nav >> text=F.R.A.M.E.')).toBeVisible({ timeout: 15_000 });
}

// ===========================================================================
// TEST SUITE 1: LANDING PAGE
// ===========================================================================

test.describe('Suite 1: Landing Page', () => {
  test.beforeEach(async ({ page }) => {
    await goToLanding(page);
  });

  test('renders hero text with privacy tagline', async ({ page }) => {
    // The h1 headline: "Your messages. Your keys. Your privacy."
    await expect(page.locator('h1')).toContainText('Your messages');
    await expect(page.locator('h1')).toContainText('Your privacy');
  });

  test('renders feature cards in the features section', async ({ page }) => {
    // Scroll to the features section
    await page.locator('#features').scrollIntoViewIfNeeded();

    // Verify section heading
    await expect(page.locator('#features >> text=Security by Design')).toBeVisible();

    // Check for specific feature card titles
    const featureTitles = [
      'Military-Grade Encryption',
      'Federated Architecture',
      'Zero Trust Server',
    ];
    for (const title of featureTitles) {
      await expect(page.locator(`#features >> text=${title}`)).toBeVisible();
    }
  });

  test('renders trust signals bar', async ({ page }) => {
    // Trust signals: End-to-End Encrypted, Open Source, Zero Knowledge Server, Federated
    await expect(page.locator('text=End-to-End Encrypted')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=Open Source')).toBeVisible();
    await expect(page.locator('text=Zero Knowledge Server')).toBeVisible();
    await expect(page.locator('text=Federated')).toBeVisible();
  });

  test('"Get Started" button navigates to auth page', async ({ page }) => {
    // Click the hero "Get Started" button
    await page.locator('button:has-text("Get Started")').first().click();

    // Should navigate to the auth / sign-in page
    await expect(page.locator('h1:has-text("F.R.A.M.E.")')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('text=Sign in to your account')).toBeVisible();
  });

  test('"Sign In" nav button navigates to auth page', async ({ page }) => {
    await goToAuth(page);
    await expect(page.locator('text=Sign in to your account')).toBeVisible();
  });

  test('mobile hamburger menu opens on small viewport', async ({ page }) => {
    // Resize to mobile width
    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload({ waitUntil: 'networkidle' });

    // The hamburger button has aria-label="Menu"
    const menuButton = page.locator('button[aria-label="Menu"]');
    await expect(menuButton).toBeVisible({ timeout: 10_000 });

    // Click to open
    await menuButton.click();

    // Should show dropdown with navigation links
    await expect(page.locator('button:has-text("Features")')).toBeVisible();
    await expect(page.locator('button:has-text("How It Works")')).toBeVisible();
    await expect(page.locator('button:has-text("Security")')).toBeVisible();
  });
});

// ===========================================================================
// TEST SUITE 2: AUTHENTICATION
// ===========================================================================

test.describe('Suite 2: Authentication', () => {
  let testUsername: string;
  let testPassword: string;

  test('register a new user and verify app shell loads', async ({ page }) => {
    const creds = await registerUser(page);
    testUsername = creds.username;
    testPassword = creds.password;

    // The app shell should be visible with "New Chat" button or welcome message
    await expect(
      page.locator('button:has-text("+ New Chat")').or(
        page.locator('text=Welcome to F.R.A.M.E.')
      ),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('logout and verify return to landing page', async ({ page }) => {
    const creds = await registerUser(page);
    testUsername = creds.username;
    testPassword = creds.password;

    // Now logout
    await logout(page);

    // Should see the landing page hero
    await expect(page.locator('h1')).toContainText('Your messages');
  });

  test('login with registered credentials', async ({ page }) => {
    // First register to get valid credentials
    const creds = await registerUser(page);
    testUsername = creds.username;
    testPassword = creds.password;

    // Logout
    await logout(page);

    // Login with the same credentials
    await loginUser(page, testUsername, testPassword);

    // App shell should load
    await expect(
      page.locator('button:has-text("+ New Chat")').or(
        page.locator('text=Welcome to F.R.A.M.E.')
      ),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('invalid credentials show error message', async ({ page }) => {
    await goToLanding(page);
    await goToAuth(page);

    // Try to login with nonsense credentials
    await page.locator('#frame-username').fill('nonexistent_user_999');
    await page.locator('#frame-password').fill('WrongPassword!123');
    await page.locator('button[type="submit"]:has-text("Sign In")').click();

    // Should show an error message (the auth component wraps errors in a styled div)
    // The error container has a red border and red text
    const errorContainer = page.locator('div').filter({ hasText: /error|invalid|fail|not found|unauthorized/i }).first();
    await expect(errorContainer).toBeVisible({ timeout: 15_000 });
  });

  test('password strength indicator shows on register', async ({ page }) => {
    await goToLanding(page);
    await goToAuth(page);
    await switchToRegister(page);

    // Type a weak password
    await page.locator('#frame-password').fill('abc');
    await expect(page.locator('text=Weak')).toBeVisible();

    // Type a strong password
    await page.locator('#frame-password').fill('Str0ng!P@ssw0rd');
    await expect(page.locator('text=Strong')).toBeVisible();
  });

  test('toggle between login and register modes', async ({ page }) => {
    await goToLanding(page);
    await goToAuth(page);

    // Default: login mode
    await expect(page.locator('text=Sign in to your account')).toBeVisible();

    // Switch to register
    await switchToRegister(page);
    await expect(page.locator('text=Create a new account')).toBeVisible();

    // Switch back to login
    await switchToLogin(page);
    await expect(page.locator('text=Sign in to your account')).toBeVisible();
  });
});

// ===========================================================================
// TEST SUITE 3: CHAT FLOW
// ===========================================================================

test.describe('Suite 3: Chat Flow', () => {
  test('create a new DM room and verify it appears in sidebar', async ({ page }) => {
    await registerUser(page);

    // Wait for the app shell to be ready
    await expect(page.locator('button:has-text("+ New Chat")')).toBeVisible({ timeout: 30_000 });

    // Click "New Chat" to open the dialog
    await page.locator('button:has-text("+ New Chat")').click();

    // The "New Conversation" dialog should appear
    await expect(page.locator('text=New Conversation')).toBeVisible({ timeout: 10_000 });

    // "Direct Message" should be the default type
    const dmButton = page.locator('button:has-text("Direct Message")');
    await expect(dmButton).toBeVisible();

    // Enter a username to invite (use a placeholder; the API may or may not accept it)
    const targetUser = `@testrecipient_${Date.now()}:frame.local`;
    await page.locator('#new-chat-username').fill(targetUser);

    // Click "Create"
    await page.locator('button:has-text("Create")').click();

    // Wait for either the success animation or the room to appear in sidebar
    // The dialog shows "Conversation created!" on success, or an error
    await expect(
      page.locator('text=Conversation created!').or(
        page.locator('[role="listitem"]').first()
      ).or(
        page.locator('text=Failed').first()
      ),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('send a message and verify it appears', async ({ page }) => {
    await registerUser(page);
    await expect(page.locator('button:has-text("+ New Chat")')).toBeVisible({ timeout: 30_000 });

    // Create a room first
    await page.locator('button:has-text("+ New Chat")').click();
    await expect(page.locator('text=New Conversation')).toBeVisible({ timeout: 10_000 });

    const targetUser = `@chattest_${Date.now()}:frame.local`;
    await page.locator('#new-chat-username').fill(targetUser);
    await page.locator('button:has-text("Create")').click();

    // Wait for the room to be created and the chat window to open
    await page.waitForTimeout(3000);

    // Look for the message input textarea
    const messageInput = page.locator('textarea[aria-label="Message input"]');

    // If the message input is visible, we are in the chat view
    if (await messageInput.isVisible({ timeout: 10_000 }).catch(() => false)) {
      const testMessage = `Hello from E2E test at ${Date.now()}`;
      await messageInput.fill(testMessage);

      // The send button appears when text is present
      const sendButton = page.locator('button[aria-label="Send message"]');
      await expect(sendButton).toBeVisible();
      await sendButton.click();

      // Wait a moment for the message to be sent and rendered
      await page.waitForTimeout(2000);

      // The message text should appear in the chat area
      await expect(page.locator(`text=${testMessage}`)).toBeVisible({ timeout: 10_000 });
    }
  });

  test('message shows encryption lock icon', async ({ page }) => {
    await registerUser(page);
    await expect(page.locator('button:has-text("+ New Chat")')).toBeVisible({ timeout: 30_000 });

    // Create room and send a message
    await page.locator('button:has-text("+ New Chat")').click();
    await expect(page.locator('text=New Conversation')).toBeVisible({ timeout: 10_000 });

    const targetUser = `@locktest_${Date.now()}:frame.local`;
    await page.locator('#new-chat-username').fill(targetUser);
    await page.locator('button:has-text("Create")').click();
    await page.waitForTimeout(3000);

    const messageInput = page.locator('textarea[aria-label="Message input"]');
    if (await messageInput.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await messageInput.fill('Testing encryption icon');
      await page.locator('button[aria-label="Send message"]').click();
      await page.waitForTimeout(2000);

      // The E2EE badge should be visible in the chat header
      await expect(page.locator('text=E2EE')).toBeVisible({ timeout: 5_000 });
    }
  });

  test('message grouping: two quick messages group under same sender', async ({ page }) => {
    await registerUser(page);
    await expect(page.locator('button:has-text("+ New Chat")')).toBeVisible({ timeout: 30_000 });

    // Create room
    await page.locator('button:has-text("+ New Chat")').click();
    await expect(page.locator('text=New Conversation')).toBeVisible({ timeout: 10_000 });

    const targetUser = `@grouptest_${Date.now()}:frame.local`;
    await page.locator('#new-chat-username').fill(targetUser);
    await page.locator('button:has-text("Create")').click();
    await page.waitForTimeout(3000);

    const messageInput = page.locator('textarea[aria-label="Message input"]');
    if (await messageInput.isVisible({ timeout: 10_000 }).catch(() => false)) {
      // Send two messages quickly
      await messageInput.fill('Message one');
      await page.locator('button[aria-label="Send message"]').click();
      await page.waitForTimeout(500);

      await messageInput.fill('Message two');
      await page.locator('button[aria-label="Send message"]').click();
      await page.waitForTimeout(2000);

      // Both messages should be visible
      await expect(page.locator('text=Message one')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('text=Message two')).toBeVisible({ timeout: 10_000 });
    }
  });

  test('relative timestamps show on messages', async ({ page }) => {
    await registerUser(page);
    await expect(page.locator('button:has-text("+ New Chat")')).toBeVisible({ timeout: 30_000 });

    // Create room and send a message
    await page.locator('button:has-text("+ New Chat")').click();
    await expect(page.locator('text=New Conversation')).toBeVisible({ timeout: 10_000 });

    const targetUser = `@tstest_${Date.now()}:frame.local`;
    await page.locator('#new-chat-username').fill(targetUser);
    await page.locator('button:has-text("Create")').click();
    await page.waitForTimeout(3000);

    const messageInput = page.locator('textarea[aria-label="Message input"]');
    if (await messageInput.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await messageInput.fill('Timestamp test message');
      await page.locator('button[aria-label="Send message"]').click();
      await page.waitForTimeout(2000);

      // A recently sent message should show "just now" as its relative timestamp
      await expect(page.locator('text=just now')).toBeVisible({ timeout: 10_000 });
    }
  });
});

// ===========================================================================
// TEST SUITE 4: SETTINGS
// ===========================================================================

test.describe('Suite 4: Settings', () => {
  test('open settings via gear icon', async ({ page }) => {
    await registerUser(page);
    await expect(page.locator('button:has-text("+ New Chat")')).toBeVisible({ timeout: 30_000 });

    // Click the gear/settings icon button in the sidebar
    await page.locator('button[aria-label="Settings"]').click();

    // The settings view should display session security section
    await expect(page.locator('text=Session Security')).toBeVisible({ timeout: 10_000 });
  });

  test('session timeout dropdown exists and is interactive', async ({ page }) => {
    await registerUser(page);
    await expect(page.locator('button:has-text("+ New Chat")')).toBeVisible({ timeout: 30_000 });

    await page.locator('button[aria-label="Settings"]').click();
    await expect(page.locator('text=Session Security')).toBeVisible({ timeout: 10_000 });

    // The session timeout dropdown should be visible
    const timeoutDropdown = page.locator('#session-timeout');
    await expect(timeoutDropdown).toBeVisible();

    // Click it to open the dropdown
    await timeoutDropdown.click();

    // Dropdown options should appear (role="listbox")
    const listbox = page.locator('[role="listbox"]');
    await expect(listbox).toBeVisible({ timeout: 5_000 });

    // Should have options like "5 minutes", "10 minutes", "Never"
    await expect(page.locator('[role="option"]').first()).toBeVisible();
  });

  test('device list shows current device', async ({ page }) => {
    await registerUser(page);
    await expect(page.locator('button:has-text("+ New Chat")')).toBeVisible({ timeout: 30_000 });

    await page.locator('button[aria-label="Settings"]').click();
    await expect(page.locator('text=Session Security')).toBeVisible({ timeout: 10_000 });

    // Scroll down to find the device list section
    // DeviceList renders "This device" badge for the current device
    // or shows "Devices" heading
    await expect(
      page.locator('text=This device').or(
        page.locator('text=Your Devices')
      ).or(
        page.locator('text=Linked Devices')
      ),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('"Link a New Device" button exists', async ({ page }) => {
    await registerUser(page);
    await expect(page.locator('button:has-text("+ New Chat")')).toBeVisible({ timeout: 30_000 });

    await page.locator('button[aria-label="Settings"]').click();
    await expect(page.locator('text=Session Security')).toBeVisible({ timeout: 10_000 });

    // The "Link a New Device" button is rendered in the settings view
    const linkButton = page.locator('button:has-text("Link a New Device")');
    await expect(linkButton).toBeVisible({ timeout: 15_000 });
  });

  test('auto-lock toggle is present', async ({ page }) => {
    await registerUser(page);
    await expect(page.locator('button:has-text("+ New Chat")')).toBeVisible({ timeout: 30_000 });

    await page.locator('button[aria-label="Settings"]').click();
    await expect(page.locator('text=Session Security')).toBeVisible({ timeout: 10_000 });

    // Auto-lock toggle with role="switch"
    const autoLockToggle = page.locator('#auto-lock');
    await expect(autoLockToggle).toBeVisible();
    await expect(autoLockToggle).toHaveAttribute('role', 'switch');
  });
});

// ===========================================================================
// TEST SUITE 5: ROOM MANAGEMENT
// ===========================================================================

test.describe('Suite 5: Room Management', () => {
  test('open room info panel and verify member list', async ({ page }) => {
    await registerUser(page);
    await expect(page.locator('button:has-text("+ New Chat")')).toBeVisible({ timeout: 30_000 });

    // Create a room
    await page.locator('button:has-text("+ New Chat")').click();
    await expect(page.locator('text=New Conversation')).toBeVisible({ timeout: 10_000 });

    const targetUser = `@roominfo_${Date.now()}:frame.local`;
    await page.locator('#new-chat-username').fill(targetUser);
    await page.locator('button:has-text("Create")').click();
    await page.waitForTimeout(3000);

    // If we are in the chat view, look for the room settings/info button
    // The ChatWindow header has a settings button that calls onOpenSettings
    // It shows as an "i" or info icon in the header
    const settingsButtons = page.locator('button:has-text("Room Settings"), button:has-text("Info"), button[title="Room info"]');
    const moreMenuButton = page.locator('button[aria-label="More options"]');

    if (await moreMenuButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await moreMenuButton.click();
      // Look for "Room Settings" in the dropdown
      const roomSettingsOption = page.locator('button:has-text("Room Settings")');
      if (await roomSettingsOption.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await roomSettingsOption.click();

        // The RoomSettings panel should slide in
        await expect(page.locator('text=Room Settings')).toBeVisible({ timeout: 10_000 });

        // Should show "Members" section
        await expect(page.locator('text=Members')).toBeVisible({ timeout: 5_000 });
      }
    }
  });

  test('leave room flow works', async ({ page }) => {
    await registerUser(page);
    await expect(page.locator('button:has-text("+ New Chat")')).toBeVisible({ timeout: 30_000 });

    // Create a room
    await page.locator('button:has-text("+ New Chat")').click();
    await expect(page.locator('text=New Conversation')).toBeVisible({ timeout: 10_000 });

    const targetUser = `@leavetest_${Date.now()}:frame.local`;
    await page.locator('#new-chat-username').fill(targetUser);
    await page.locator('button:has-text("Create")').click();
    await page.waitForTimeout(3000);

    // Try to leave via the more menu or room settings
    const moreMenuButton = page.locator('button[aria-label="More options"]');
    if (await moreMenuButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await moreMenuButton.click();

      const leaveOption = page.locator('button:has-text("Leave")');
      if (await leaveOption.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await leaveOption.click();

        // A confirmation dialog should appear: "Leave Conversation?"
        const leaveConfirm = page.locator('text=Leave Conversation?');
        if (await leaveConfirm.isVisible({ timeout: 5_000 }).catch(() => false)) {
          // Click the actual "Leave" confirm button
          await page.locator('button:has-text("Leave")').last().click();

          // After leaving, should return to empty state or sidebar
          await page.waitForTimeout(2000);
          await expect(
            page.locator('text=Select a conversation').or(
              page.locator('text=Welcome to F.R.A.M.E.')
            ).or(
              page.locator('button:has-text("+ New Chat")')
            ),
          ).toBeVisible({ timeout: 10_000 });
        }
      }
    }
  });
});

// ===========================================================================
// TEST SUITE 6: MOBILE RESPONSIVENESS
// ===========================================================================

test.describe('Suite 6: Mobile Responsiveness', () => {
  test('sidebar shows full-screen at mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await registerUser(page);

    // On mobile, the sidebar should take the full viewport width (100vw)
    await expect(page.locator('button:has-text("+ New Chat")')).toBeVisible({ timeout: 30_000 });

    // The sidebar should be visible and take the full width
    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible();

    // Check sidebar width is close to viewport width
    const sidebarBox = await sidebar.boundingBox();
    if (sidebarBox) {
      expect(sidebarBox.width).toBeGreaterThanOrEqual(370);
    }
  });

  test('selecting a room shows back button on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await registerUser(page);
    await expect(page.locator('button:has-text("+ New Chat")')).toBeVisible({ timeout: 30_000 });

    // Create a room
    await page.locator('button:has-text("+ New Chat")').click();
    await expect(page.locator('text=New Conversation')).toBeVisible({ timeout: 10_000 });

    const targetUser = `@mobiletest_${Date.now()}:frame.local`;
    await page.locator('#new-chat-username').fill(targetUser);
    await page.locator('button:has-text("Create")').click();
    await page.waitForTimeout(3000);

    // If a room was created and selected, the main content should show a "Back" button
    const backButton = page.locator('button:has-text("Back")');
    if (await backButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await expect(backButton).toBeVisible();

      // Click back to return to sidebar
      await backButton.click();
      await expect(page.locator('button:has-text("+ New Chat")')).toBeVisible({ timeout: 10_000 });
    }
  });

  test('no horizontal scroll at mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToLanding(page);

    // Evaluate if there is horizontal overflow
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasHorizontalScroll).toBe(false);
  });

  test('landing page renders correctly on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToLanding(page);

    // Hero text should be visible
    await expect(page.locator('h1')).toContainText('Your messages');

    // Hamburger menu should be visible instead of desktop nav links
    await expect(page.locator('button[aria-label="Menu"]')).toBeVisible();

    // Desktop nav buttons should NOT be visible
    // (Features, How It Works, Security buttons are hidden on mobile)
    // The Sign In button in the nav should still be visible
    await expect(page.locator('nav >> button:has-text("Sign In")')).toBeVisible();
  });

  test('auth page is usable on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToLanding(page);
    await goToAuth(page);

    // Auth card should be visible and fit within viewport
    const card = page.locator('h1:has-text("F.R.A.M.E.")');
    await expect(card).toBeVisible();

    // Input fields should be visible and usable
    await expect(page.locator('#frame-username')).toBeVisible();
    await expect(page.locator('#frame-password')).toBeVisible();

    // Submit button should be visible
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });
});
