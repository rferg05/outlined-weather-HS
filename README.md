# outlined-weather-HS
Weather module for Homescreens raspberry pi

Weather with an outline around the text and icons, so it stays readable over photos and busy backgrounds.

## Install

In the Home Screens editor, open the Plugin Store, choose **Install from URL**, and paste:

```
https://github.com/rferg05/outlined-weather-HS/releases/download/v{version}/outlined-weather-{version}.tar.gz
```

Home Screens fills in `{version}`, so the **Update** button can pick up newer releases.

## Building

```bash
npm install
npm run build
```

This produces `dist/bundle.js`. To make a release tarball, wrap `manifest.json` and `dist/` in a single `outlined-weather/` folder:

```bash
mkdir -p pkg/outlined-weather/dist
cp manifest.json pkg/outlined-weather/
cp dist/bundle.js dist/bundle.js.map pkg/outlined-weather/dist/
tar -czf outlined-weather-<version>.tar.gz -C pkg outlined-weather
```

Attach it to a GitHub release tagged `v<version>`.
