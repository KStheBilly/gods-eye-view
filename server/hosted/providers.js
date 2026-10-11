import { openSkyProxy } from '../providers/aircraft/opensky.js';
import { celestrakProxy, rocketLaunchesProxy } from '../providers/space.js';
import { tomtomProxy } from '../providers/traffic.js';
import { firmsProxy } from '../providers/firms.js';
import { terrainHeightsProxy } from '../providers/terrain.js';
import { adsbdbProxy } from '../providers/aircraft/enrichment.js';
import { overpassProxy } from '../providers/overpass.js';
import { militaryInstallationsProxy } from '../providers/military-installations.js';
import { regionalBriefProxy } from '../providers/regional/briefing.js';
import { geocodeProxy } from '../providers/regional/place.js';
import { weatherEffectsProxy } from '../providers/regional/weather-effects.js';
import { cctvProxy } from '../providers/cctv.js';
import { defaultSourceRoot } from '../providers/common/source-root.js';
import { radioBrowserProxy } from '../providers/radio.js';
import { gbfsProxy } from '../providers/gbfs.js';
import { transitProxy } from '../providers/transit.js';
import { adsbLolProxy } from '../providers/aircraft/adsb-lol.js';
import { aisLiveProxy } from '../providers/vessels/ais-live.js';
import { trackBackfillProxies } from '../providers/aircraft/tracks.js';
import { googlePlacesContextProxy } from '../providers/places.js';
import { mapillaryProxy } from '../providers/mapillary.js';
import { weatherProxy } from '../providers/weather.js';
import { firePerimetersProxy } from '../providers/firePerimeters.js';
import { cycloneProxy } from '../providers/cyclones.js';
import { windProxy } from '../providers/wind.js';
import { handleHudSummary } from '../providers/openai/hud-summary.js';
import { createRealtimeTokenHandler } from '../providers/openai/realtime.js';
import { sameSiteGated } from '../providers/common/same-site.js';
import { standaloneVoiceTools } from '../standalone/voiceTools.js';

/** Reuse the maintained provider handlers without running a development server. */
export function installHostedProviders(server) {
  const plugins = [
    openSkyProxy(),
    celestrakProxy(),
    tomtomProxy(),
    firmsProxy(),
    rocketLaunchesProxy(),
    terrainHeightsProxy(),
    adsbdbProxy(),
    overpassProxy(),
    militaryInstallationsProxy(),
    regionalBriefProxy(),
    geocodeProxy(),
    weatherEffectsProxy(),
    cctvProxy({ sourceRoot: defaultSourceRoot }),
    radioBrowserProxy(),
    gbfsProxy(),
    transitProxy(),
    adsbLolProxy(),
    aisLiveProxy(),
    trackBackfillProxies(),
    googlePlacesContextProxy(),
    windProxy(),
    weatherProxy(),
    cycloneProxy(),
    mapillaryProxy(),
    firePerimetersProxy(),
  ];
  for (const plugin of plugins) plugin.configurePreviewServer(server);

  // Deliberately do not construct the local OpenAI plugin: doing so would
  // also construct Codex login/debug routes. The only hosted credential is an
  // API key, and the OAuth resolver cannot read local files even if miscalled.
  server.middlewares.use(
    '/api/openai/hud-summary',
    sameSiteGated(handleHudSummary),
  );
  server.middlewares.use(
    '/api/realtime/token',
    sameSiteGated(
      createRealtimeTokenHandler({
        tools: standaloneVoiceTools(),
        environment: { GEV_PREFER_CODEX_OAUTH: 'false' },
        resolveOAuthAccessToken: () => {
          throw new Error('OAuth is unavailable in hosted mode');
        },
      }),
    ),
  );
}
