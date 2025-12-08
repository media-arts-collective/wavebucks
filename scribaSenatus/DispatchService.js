/**
 * DispatchService.gs
 * Defines routing between detected command types and services.
 */

const DispatchTable = {
  'HELP': () => Personality.get('HELP'),
  'QUOT': (email) => {
    const balance = Wavebucks.Wavebucks.getBalance(email);
    return MessageBuilder.buildDigest({ balance });
  },
  'DEFAULT': () => MessageBuilder.buildErrorMessage("Unrecognized command.")
};
