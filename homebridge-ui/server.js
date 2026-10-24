/**
 * Backend for the plugin's settings page in the Homebridge UI: tells the
 * page this machine's address, for the link to the dashboard the plugin
 * serves here.
 */
import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils';

import { ownAddress } from '../dist/address.js';

class SynologyMonitorUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    this.onRequest('/address', () => ownAddress());
    this.ready();
  }
}

(() => new SynologyMonitorUiServer())();
