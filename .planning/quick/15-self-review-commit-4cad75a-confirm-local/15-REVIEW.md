# Self-Review: Commit 4cad75a -- Localhost Detection on Real Device

**Commit:** 4cad75a `fix(health): detect localhost gateway URL on real device and show actionable error`
**Files changed:** settings.ts, app-wiring.ts, hub-main.ts, glasses-main.ts, settings.test.ts, app-wiring.test.ts, glasses-main.test.ts
**Tests added:** 28 new test cases across 3 test files (isLocalhostUrl: 13, isRealDeviceRuntime: 2, localhostWarning: 5, buildHealthViewModel localhost: 8)

---

## Strengths

1. **Device-aware guard with dev-mode bypass.** The detection correctly treats localhost as valid in browser dev mode (no `flutter_inappwebview`) while warning only on real devices where localhost genuinely points to the phone. This avoids disrupting development workflows.

2. **Multi-layer defense.** The fix intercepts the problem at three independent points:
   - **Boot-time** in glasses-main.ts (line 497): Skips the health check entirely and shows an error on the glasses display, preventing a confusing "Unreachable" message.
   - **Boot-time** in hub-main.ts (line 1123): Sets `gatewayLiveStatus = 'error'` and logs an actionable message before attempting any network request, avoiding a wasted fetch.
   - **Health display** in app-wiring.ts `buildHealthViewModel` (line 187): Overrides the gateway health dot to `err` with a clear label ("localhost points to phone -- use server URL"), regardless of live status. This ensures the UI is correct even if status changes arrive asynchronously.

3. **Priority override in health display.** The localhost-on-device check is the first branch in `buildHealthViewModel`'s gateway logic (lines 187-189), taking priority over connected/ready/connecting/error states. This prevents a misleading momentary "Ready" flash if the phone happens to respond on that port.

4. **Backward compatibility.** The `isOnDevice` parameter defaults to `undefined` (falsy), so all existing callers that don't pass it continue to work identically. The 8 new `buildHealthViewModel` tests explicitly verify backward-compat scenarios.

5. **Test coverage breadth.** The regex is tested against 13 URL patterns (positive and negative), including case-insensitive LOCALHOST, path-only occurrences (`http://example.com/localhost`), and IPv6 with/without port. The `localhostWarning` composite function is tested across all 4 combinations of (localhost/non-localhost) x (device/browser).

6. **Actionable messaging.** Error strings tell the user exactly what to do: "Gateway: localhost = phone. Set server URL." (glasses) and "Gateway URL uses localhost which points to the phone, not the server. Update the Gateway URL in Settings to use the server IP or hostname." (hub log).

---

## Detection Logic Correctness

### LOOPBACK_RE: `^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)`

**Anchoring:** The regex is correctly anchored with `^` at start and requires the hostname to be followed by either `:` (port), `/` (path), or `$` (end-of-string). This means:
- `http://localhost.evil.com` -- does NOT match (after "localhost" comes `.`, which is neither `:`, `/`, nor `$`). Verified by runtime test.
- `http://localhost-proxy.mycompany.com:4400` -- does NOT match (after "localhost" comes `-`). Verified.
- `http://localhost:4400` -- matches correctly.
- `http://localhost` -- matches correctly (end-of-string after hostname).
- `http://localhost/path` -- matches correctly (slash after hostname).

**Case insensitivity:** The `i` flag correctly handles `http://LOCALHOST:4400`. Verified.

**Conclusion:** LOOPBACK_RE is correctly anchored and cannot be bypassed by subdomains or hostname prefixes.

### isRealDeviceRuntime: `typeof window.flutter_inappwebview !== 'undefined'`

This checks for the Even App WebView marker. The `flutter_inappwebview` object is injected by the Flutter InAppWebView plugin, which is the standard WebView component used by the Even App. This is the canonical marker for detecting real-device runtime.

**Consistency check:** glasses-main.ts uses `!devMode` where `devMode = typeof (window as any).flutter_inappwebview === 'undefined'` (line 59). This means `!devMode === isRealDeviceRuntime()`. hub-main.ts calls `isRealDeviceRuntime()` directly (line 1123) and passes it to `buildHealthViewModel` (line 144 of refreshHealthDisplay). These are logically equivalent and consistent.

### buildHealthViewModel `isOnDevice` parameter

The parameter defaults to `undefined` (falsy) when not provided. Only when explicitly `true` AND the URL is localhost does the override activate. This preserves backward compatibility for any caller that doesn't pass the parameter.

**Conclusion:** All three detection functions are correct and consistent across both runtimes.

---

## False-Positive Risks

### 1. Android emulator with flutter_inappwebview + localhost URL

**Risk: NONE (warning is correct)**

On Android emulator, `flutter_inappwebview` IS injected (the Even App runs in the emulator's WebView). The emulator's `localhost`/`127.0.0.1` refers to the emulator's own loopback interface, NOT the host machine. Developers must use `10.0.2.2` to reach the host machine's localhost from the Android emulator. The warning correctly fires: localhost on the emulator IS wrong.

### 2. iOS Simulator with flutter_inappwebview + localhost URL

**Risk: LOW (warning is arguably correct but debatable)**

iOS Simulator shares the host machine's network stack, so `localhost` in the simulator actually DOES reach the host machine's services. However, `flutter_inappwebview` is present when running the Even App. The warning would fire, telling the user to use the server IP -- which is slightly misleading in this specific case since localhost works.

Mitigating factors:
- iOS Simulator is a developer-only environment, not end-user facing.
- Using the server IP instead of localhost also works in the simulator, so following the advice causes no harm.
- This scenario is vanishingly rare in practice (developers test in browser dev mode, not the simulator with localhost).

### 3. URL like "http://localhost-proxy.mycompany.com:4400"

**Risk: NONE**

Verified by runtime test: the regex requires the hostname to be EXACTLY `localhost`, `127.0.0.1`, or `[::1]` followed by port, slash, or end-of-string. `localhost-proxy` does not match because `-` is not one of those terminators.

---

## False-Negative Risks

### 1. `0.0.0.0` (bind-all-interfaces address)

**Risk: LOW**

`0.0.0.0` is not in LOOPBACK_RE. On mobile devices, `http://0.0.0.0:4400` would fail the same way as localhost -- the phone has no gateway server running. The regex would not detect this, and the user would see a generic "Unreachable" error without the actionable localhost guidance.

**Impact:** Very low. `0.0.0.0` is a server-side bind address, almost never used in client-facing URLs. No user would type `http://0.0.0.0:4400` as a gateway URL. The FIELD_CONFIG placeholder says `http://your-server:4400` which guides users toward IPs/hostnames.

### 2. Custom domain resolving to 127.0.0.1 (e.g., `http://mygateway.local:4400` in /etc/hosts)

**Risk: LOW**

The regex checks the hostname string, not DNS resolution. A custom domain like `mygateway.local` pointing to 127.0.0.1 would pass the regex check, the health fetch would fail, and the user would see "Unreachable" without the localhost-specific guidance.

**Impact:** Low. This requires deliberate /etc/hosts configuration. Users who set up custom DNS entries are technical enough to understand the loopback problem. Mobile devices don't have easily editable /etc/hosts files.

### 3. LAN IPs like 192.168.x.x or 10.x.x.x

**Risk: NONE (not a false negative)**

LAN IPs ARE reachable from the phone when on the same WiFi network. These should NOT trigger the localhost warning. The regex correctly excludes them.

### 4. IPv4-mapped IPv6 like `::ffff:127.0.0.1`

**Risk: VERY LOW**

`http://[::ffff:127.0.0.1]:4400` is not matched by the regex. On mobile, this would fail the same way as localhost.

**Impact:** Negligible. No user would type this format. Browsers normalize IPv6 addresses before presenting them to JavaScript. The URL input field validation would likely reject this format before it reaches the loopback check.

### 5. `http://[::1]` without port

**Risk: NONE**

Already handled by the regex. The `(:\d+)?` group is optional, and `(\/|$)` matches end-of-string. Verified by test: `isLocalhostUrl('http://[::1]')` returns `true`.

---

## Emulator and User-Agent Quirks

### Android Emulator
- `flutter_inappwebview`: Present (Even App runs in emulator WebView).
- `localhost`: Points to emulator's own loopback, NOT the host machine. Use `10.0.2.2` for host access.
- **Warning behavior:** Fires correctly. The warning is accurate and helpful.

### iOS Simulator
- `flutter_inappwebview`: Present (Even App runs in simulator WebView).
- `localhost`: Points to the HOST machine (iOS Simulator shares network stack).
- **Warning behavior:** Fires, but is a false positive for this specific case. Impact is minimal -- developers use browser dev mode, not the simulator with localhost URLs. Using the server IP instead of localhost also works.

### Chrome DevTools "Toggle Device Toolbar" (Responsive Mode)
- `flutter_inappwebview`: NOT present (plain browser).
- `devMode`: `true` in glasses-main.ts; `isRealDeviceRuntime()` returns `false` in hub-main.ts.
- **Warning behavior:** Does not fire. Correct -- localhost is valid in browser dev mode.

### flutter_inappwebview in debug/development builds on device
- `flutter_inappwebview`: Present (injected by the Flutter plugin regardless of build mode).
- **Warning behavior:** Fires if localhost URL is set. This is correct -- even in debug builds running on a physical device, localhost points to the phone's own loopback, not the development server. The developer must use the server's IP or hostname.

### WebView2 or other embedded browsers
- `flutter_inappwebview`: Not present (only Flutter InAppWebView injects this).
- **Warning behavior:** Does not fire. If the app were ever ported to a non-Flutter WebView runtime, the detection would need updating. This is not a current concern.

---

## Follow-Up Recommendation

**Recommended: Option A -- Add `0.0.0.0` to LOOPBACK_RE**

```typescript
const LOOPBACK_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$)/i;
```

**Rationale:** This is a one-line regex change with zero risk of regression. While the probability of a user entering `http://0.0.0.0:4400` is very low, the cost of covering it is trivial and it closes the only false-negative gap that could occur with a plausible URL format. The existing test suite for `isLocalhostUrl` can be extended with a single additional test case (`http://0.0.0.0:4400` returns `true`). Options B and C provide more user-facing value but require significantly more implementation effort; Option A provides the best value-to-effort ratio as a quick hardening step.
