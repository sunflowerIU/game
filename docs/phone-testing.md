# Local phone testing

## Recommended path

The player app already proxies `/api` and `/health` to the private backend. A
phone therefore needs access only to port `3000`; PostgreSQL, the backend on
port `4000`, and the private admin app should not be exposed to the LAN.

1. Start the local stack with `docker compose up -d`.
2. Run `ipconfig` and find the IPv4 address of the active Wi-Fi adapter.
3. Verify that address from the repository root:

   ```powershell
   pwsh ./infrastructure/scripts/check-phone-access.ps1 -HostAddress 192.168.1.25
   ```

4. Connect the phone to the same Wi-Fi and open the exact URL printed by the
   script, such as `http://192.168.1.25:3000`.

Do not open `localhost` on the phone: that name means the phone itself. Do not
append port `4000`: the browser should use the web app's same-origin proxy so
login cookies and API requests stay on one origin.

## If the page does not open

- Confirm the PC and phone are on the same non-guest Wi-Fi network. Guest Wi-Fi
  commonly blocks communication between devices.
- Confirm Docker shows the `web` service listening on `0.0.0.0:3000`.
- Set the active Windows network profile to Private and allow inbound TCP 3000
  only on the Private profile if Windows Firewall blocks it.
- Disconnect VPN software temporarily if it intercepts or isolates local-LAN
  traffic.

Do not create a broad public firewall rule and do not port-forward 3000 on the
router. This HTTP setup is for trusted local testing only.

## If the page opens but login fails

Open `http://PC-IP:3000/health/ready` on the phone. It should return a small JSON
response with HTTP 200. If it does, the frontend can reach the backend through
the correct proxy.

Keep `NEXT_PUBLIC_API_BASE_URL` empty for this Docker development workflow. A
value such as `http://localhost:4000` makes a phone call itself instead of the
PC and breaks login. After changing environment values, rebuild/restart the web
container and clear the phone browser's site data for the PC-IP origin.

## Portrait, landscape, and browser chrome

The player interface supports both orientations. Use portrait when the browser
toolbar consumes too much landscape height. On Android Chrome, adding the site
to the home screen or using the in-game fullscreen control after a tap can
reduce browser chrome. iOS Safari decides when its bars collapse and does not
allow a normal webpage to hide them reliably; Add to Home Screen gives the most
app-like test.

For production, repeat on HTTPS using the real hostname. Camera cutouts,
safe-area insets, audio unlock, fullscreen behavior, and Wi-Fi/mobile-data
transitions still require physical iPhone and Android verification.

## Section 11 verification evidence

On the local development machine, `192.168.100.119:3000` returned the player
application, proxied readiness returned HTTP 200, and an unauthenticated identity
request returned the expected HTTP 401. A disposable player then authenticated
through that LAN origin, received an HttpOnly `gp_session` cookie, and loaded
its identity through the same origin. The disposable player was deleted after
the check. Neon Mines remained disabled throughout this section.
