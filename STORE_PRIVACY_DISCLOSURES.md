# ClickAway Store Privacy Disclosure Checklist (Draft)

This checklist is based on the current source code and must be reconciled with the final public privacy-policy URL and the actual submitted package.

## Verified implementation facts

- ClickAway's single purpose is to help users perform selected repetitive workflows on supported Printify pages.
- It stores product profiles, prices, variant choices, held variants, notes, links, variation names, selected-profile data, and floating-button positions in browser extension storage.
- It reads relevant supported Printify page content to carry out a user-requested action.
- It has a legacy migration path from `chrome.storage.sync` for `profiles`, `activeId`, and `prices`.
- It has no source-level analytics, advertising SDK, backend request, WebSocket, or remote hosted code.
- User-initiated automation can enter values into the user's existing Printify session.
- Backup export writes a user-downloaded JSON file; import reads only a file chosen by the user.

## Chrome Web Store

### Required by policy

- [ ] Provide an accurate, up-to-date privacy-policy URL in the Chrome Web Store Developer Dashboard because the extension handles user data.
- [ ] Ensure the policy and privacy fields disclose collection, use, storage, and sharing of saved profile data and Printify-page data.
- [ ] Prominently disclose data practices before installation where required by the dashboard and policy.
- [ ] State a narrow single purpose consistent with the implementation.
- [ ] Request and justify only necessary permissions.

### Recommended disclosure text to adapt

**Single purpose:** ClickAway saves reusable product preferences and performs user-initiated pricing, variant, variation-name, and supported publishing-setting actions on Printify pages.

**Storage:** Stores saved product profiles and preferences locally in the browser; legacy profiles from older versions may be migrated from browser sync storage.

**Host access:** Access to `https://printify.com/*` is used only to provide the user-facing Printify workflow features.

**Debugger:** The `debugger` permission is used only to send trusted mouse and keyboard input to the active supported Printify tab when ordinary page scripts cannot reliably update Printify controls. The implementation limits CDP use to Input mouse, keyboard, and text commands.

**No remote code / no backend:** The current package contains no remote hosted code and the extension does not send data to a ClickAway backend, analytics, or advertising provider.

## Microsoft Edge Add-ons

### Required by Partner Center flow

- [ ] Complete the Privacy page: single purpose, permission justification, remote-code declaration, data-use certification, and privacy-policy URL.
- [ ] Ensure the privacy-policy URL is publicly accessible and accurately describes collection, use, and disclosure.
- [ ] Declare the same actual data practices reflected in the package and public policy.

### Recommended answers to verify in the live form

- [ ] Remote code: no, based on the submitted package.
- [ ] Data collection: disclose locally stored user-entered profile/preferences data and relevant Printify-page data processed for user-requested automation.
- [ ] Third-party sharing: no ClickAway backend, analytics, advertising, or data broker sharing in the current implementation; disclose that Printify receives action values through the user's own Printify session.
- [ ] Permissions: use the same `storage`, `scripting`, `activeTab`, `debugger`, and Printify host-access explanations as the final package supports.

## Unresolved owner decisions

- [ ] Public privacy-policy hosting URL.
- [ ] Support email address or support URL.
- [ ] Publisher/legal identity and effective date.
- [ ] Final dashboard taxonomy for data categories; verify against the store's live choices.
- [ ] Whether the submitted package or future releases add analytics, a backend, additional hosts, Etsy automation, or changed data practices.

## Official references

- Chrome Web Store Program Policies: https://developer.chrome.com/docs/webstore/program-policies/policies/
- Microsoft Edge extension publication guidance: https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension
