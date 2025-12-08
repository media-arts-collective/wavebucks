/**
 * ServiceAdapters.js
 * Adapter layer connecting service modules (Causae, Commissio) to the InboxProcessor.
 * Provides unified interface for retrieving active items from each service.
 */

const ServiceAdapters = (() => {

  /**
   * Get list of active Causae for display in digest messages
   * @returns {Array<string>} HTML-formatted list items
   */
  function getActiveCausae() {
    try {
      return Causae.getActiveList();
    } catch (err) {
      Logger.log(`⚠️ Error loading active Causae: ${err.message}`);
      return ['<i>(Error loading Causae)</i>'];
    }
  }

  /**
   * Get list of active Commissiones for display in digest messages
   * @returns {Array<string>} HTML-formatted list items
   */
  function getActiveCommissio() {
    try {
      return Commissio.getActiveList();
    } catch (err) {
      Logger.log(`⚠️ Error loading active Commissiones: ${err.message}`);
      return ['<i>(Error loading Commissiones)</i>'];
    }
  }

  return {
    getActiveCausae,
    getActiveCommissio
  };

})();
