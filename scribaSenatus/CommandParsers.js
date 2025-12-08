/**
 * CommandParsers.js
 * Parses email body text into structured command objects.
 * Each parser extracts parameters for specific command types.
 */

const CommandParsers = (() => {

  /**
   * Parse CAUSA CREATE command
   * Format: CAUSA <title> | <option1> | <option2> | ... | CLOSE <date> | MIN <wager>
   * Example: CAUSA Best pizza topping | Pepperoni | Mushrooms | Pineapple | CLOSE 2025-12-15 | MIN 5
   */
  function parseCausa(body) {
    const match = body.match(/CAUSA\s+(.+?)(?:\s*\|\s*CLOSE\s+([^\|]+))?(?:\s*\|\s*MIN\s+(\d+))?$/i);
    if (!match) throw new Error("Invalid CAUSA format. Use: CAUSA <title> | <option1> | <option2> | ... | CLOSE <date> | MIN <wager>");

    const parts = match[1].split('|').map(s => s.trim());
    if (parts.length < 2) throw new Error("CAUSA requires at least a title and one option.");

    const title = parts[0];
    const options = parts.slice(1);
    const closeDateStr = match[2] || null;
    const minWager = match[3] ? parseInt(match[3], 10) : 1;

    let closingDate = null;
    if (closeDateStr) {
      closingDate = new Date(closeDateStr);
      if (isNaN(closingDate.getTime())) throw new Error("Invalid closing date format. Use: YYYY-MM-DD");
    } else {
      // Default to 7 days from now
      closingDate = new Date();
      closingDate.setDate(closingDate.getDate() + 7);
    }

    return { title, options, closingDate, minWager };
  }

  /**
   * Parse VOTE command
   * Format: VOTE <causaId> <optionIndex> <wager>
   * Example: VOTE 1 2 10
   */
  function parseVote(body) {
    const match = body.match(/VOTE\s+(\d+)\s+(\d+)\s+(\d+)/i);
    if (!match) throw new Error("Invalid VOTE format. Use: VOTE <causaId> <optionIndex> <wager>");

    return {
      causaId: parseInt(match[1], 10),
      option: parseInt(match[2], 10),
      wager: parseInt(match[3], 10)
    };
  }

  /**
   * Parse RESOLVE command
   * Format: RESOLVE <causaId> <winningOptionIndex>
   * Example: RESOLVE 1 2
   */
  function parseResolve(body) {
    const match = body.match(/RESOLVE\s+(\d+)\s+(\d+)/i);
    if (!match) throw new Error("Invalid RESOLVE format. Use: RESOLVE <causaId> <winningOptionIndex>");

    return {
      causaId: parseInt(match[1], 10),
      winningOption: parseInt(match[2], 10)
    };
  }

  /**
   * Parse COMMISSIO CREATE command
   * Format: COMMISSIO <title> | REWARD <amount> | EXPIRES <date>
   * Example: COMMISSIO Fix the login bug | REWARD 50 | EXPIRES 2025-12-20
   */
  function parseCommissio(body) {
    const match = body.match(/COMMISSIO\s+(.+?)(?:\s*\|\s*REWARD\s+(\d+))?(?:\s*\|\s*EXPIRES\s+([^\|]+))?$/i);
    if (!match) throw new Error("Invalid COMMISSIO format. Use: COMMISSIO <title> | REWARD <amount> | EXPIRES <date>");

    const title = match[1].trim();
    const reward = match[2] ? parseInt(match[2], 10) : 10; // Default reward
    const expiryStr = match[3] || null;

    let expiry = null;
    if (expiryStr) {
      expiry = new Date(expiryStr.trim());
      if (isNaN(expiry.getTime())) throw new Error("Invalid expiry date format. Use: YYYY-MM-DD");
    } else {
      // Default to 30 days from now
      expiry = new Date();
      expiry.setDate(expiry.getDate() + 30);
    }

    return { title, reward, expiry };
  }

  /**
   * Parse ACCEPT command
   * Format: ACCEPT <commissionId>
   * Example: ACCEPT 5
   */
  function parseAccept(body) {
    const match = body.match(/ACCEPT\s+(\d+)/i);
    if (!match) throw new Error("Invalid ACCEPT format. Use: ACCEPT <commissionId>");

    return { commissionId: parseInt(match[1], 10) };
  }

  /**
   * Parse COMPLETE command
   * Format: COMPLETE <commissionId>
   * Example: COMPLETE 5
   */
  function parseComplete(body) {
    const match = body.match(/COMPLETE\s+(\d+)/i);
    if (!match) throw new Error("Invalid COMPLETE format. Use: COMPLETE <commissionId>");

    return { commissionId: parseInt(match[1], 10) };
  }

  /**
   * Parse TRANSFER command
   * Format: TRANSFER <recipientEmail> <amount>
   * Example: TRANSFER user@example.com 25
   */
  function parseTransfer(body) {
    const match = body.match(/TRANSFER\s+([^\s]+)\s+(\d+)/i);
    if (!match) throw new Error("Invalid TRANSFER format. Use: TRANSFER <email> <amount>");

    return {
      to: match[1].toLowerCase().trim(),
      amount: parseInt(match[2], 10)
    };
  }

  return {
    parseCausa,
    parseVote,
    parseResolve,
    parseCommissio,
    parseAccept,
    parseComplete,
    parseTransfer
  };

})();
