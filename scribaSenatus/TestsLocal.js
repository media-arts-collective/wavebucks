/**
 * TestsLocal.js
 * Local test runner that doesn't depend on Google Apps Script services.
 * Run with: node TestsLocal.js
 */

// Mock Logger for Node.js
const Logger = {
  log: console.log
};

// Mock Google Apps Script globals
const SpreadsheetApp = {};
const GmailApp = {};

// Import the test framework
const TestRunner = (() => {
  let results = [];

  function assert(condition, message) {
    if (!condition) {
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  function assertEqual(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(`${message}\nExpected: ${expected}\nActual: ${actual}`);
    }
  }

  function assertThrows(fn, message) {
    let threw = false;
    try {
      fn();
    } catch (e) {
      threw = true;
    }
    if (!threw) {
      throw new Error(`Expected function to throw: ${message}`);
    }
  }

  function test(name, fn) {
    try {
      fn();
      results.push({ name, status: 'PASS', error: null });
      Logger.log(`✅ PASS: ${name}`);
    } catch (e) {
      results.push({ name, status: 'FAIL', error: e.message });
      Logger.log(`❌ FAIL: ${name}\n   ${e.message}`);
    }
  }

  function getResults() {
    return results;
  }

  function reset() {
    results = [];
  }

  function summary() {
    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    Logger.log(`\n${'='.repeat(50)}`);
    Logger.log(`TEST SUMMARY: ${passed} passed, ${failed} failed`);
    Logger.log('='.repeat(50));
    return { passed, failed, total: results.length };
  }

  return { assert, assertEqual, assertThrows, test, getResults, reset, summary };
})();

// Copy CommandParsers module (no Google dependencies)
const CommandParsers = (() => {

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
      closingDate = new Date();
      closingDate.setDate(closingDate.getDate() + 7);
    }

    return { title, options, closingDate, minWager };
  }

  function parseVote(body) {
    const match = body.match(/VOTE\s+(\d+)\s+(\d+)\s+(\d+)/i);
    if (!match) throw new Error("Invalid VOTE format. Use: VOTE <causaId> <optionIndex> <wager>");

    return {
      causaId: parseInt(match[1], 10),
      option: parseInt(match[2], 10),
      wager: parseInt(match[3], 10)
    };
  }

  function parseResolve(body) {
    const match = body.match(/RESOLVE\s+(\d+)\s+(\d+)/i);
    if (!match) throw new Error("Invalid RESOLVE format. Use: RESOLVE <causaId> <winningOptionIndex>");

    return {
      causaId: parseInt(match[1], 10),
      winningOption: parseInt(match[2], 10)
    };
  }

  function parseCommissio(body) {
    const match = body.match(/COMMISSIO\s+(.+?)(?:\s*\|\s*REWARD\s+(\d+))?(?:\s*\|\s*EXPIRES\s+([^\|]+))?$/i);
    if (!match) throw new Error("Invalid COMMISSIO format. Use: COMMISSIO <title> | REWARD <amount> | EXPIRES <date>");

    const title = match[1].trim();
    const reward = match[2] ? parseInt(match[2], 10) : 10;
    const expiryStr = match[3] || null;

    let expiry = null;
    if (expiryStr) {
      expiry = new Date(expiryStr.trim());
      if (isNaN(expiry.getTime())) throw new Error("Invalid expiry date format. Use: YYYY-MM-DD");
    } else {
      expiry = new Date();
      expiry.setDate(expiry.getDate() + 30);
    }

    return { title, reward, expiry };
  }

  function parseAccept(body) {
    const match = body.match(/ACCEPT\s+(\d+)/i);
    if (!match) throw new Error("Invalid ACCEPT format. Use: ACCEPT <commissionId>");

    return { commissionId: parseInt(match[1], 10) };
  }

  function parseComplete(body) {
    const match = body.match(/COMPLETE\s+(\d+)/i);
    if (!match) throw new Error("Invalid COMPLETE format. Use: COMPLETE <commissionId>");

    return { commissionId: parseInt(match[1], 10) };
  }

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

// Mock Config module with hardcoded lexicon (matches actual Config.js)
const Config = (() => {
  function getLexicon() {
    return [
      {
        type: 'HELP',
        pattern: /^HELP|^AUXILIUM/i,
        service: 'Personality',
        method: 'HELP',
        description: 'Display this help message with all available commands, categories, and examples',
        category: 'Balance & Information',
        icon: '&#128176;',
        example: 'HELP'
      },
      {
        type: 'QUOT',
        pattern: /^QUOT|^BALANCE/i,
        service: 'InboxProcessor',
        method: 'QUOT',
        description: 'Check your current Wavebucks balance and see all active Causae and Commissiones',
        category: 'Balance & Information',
        icon: '&#128176;',
        example: 'QUOT or BALANCE'
      },
      {
        type: 'CAUSA',
        pattern: /^CAUSA/i,
        service: 'Causae',
        method: 'createCausa',
        description: 'Create a collective vote with wagers. Format: CAUSA <title> | <option1> | <option2> | ... | CLOSE <YYYY-MM-DD> | MIN <wager>. Closing date and minimum wager are optional (defaults: 7 days, &#8361;1)',
        category: 'Causae (Voting & Wagering)',
        icon: '&#128179;',
        example: 'CAUSA Best pizza topping | Pepperoni | Mushrooms | CLOSE 2025-12-31 | MIN 5'
      },
      {
        type: 'VOTE',
        pattern: /^VOTE/i,
        service: 'Causae',
        method: 'vote',
        description: 'Vote on an open causa with a wager. Format: VOTE <causaId> <optionIndex> <wager>. Your wager is deducted immediately. Winners share the pot proportionally',
        category: 'Causae (Voting & Wagering)',
        icon: '&#128179;',
        example: 'VOTE 1 0 10'
      },
      {
        type: 'RESOLVE',
        pattern: /^RESOLVE/i,
        service: 'Causae',
        method: 'resolveCausa',
        description: 'Resolve a causa and distribute winnings to voters who chose the winning option. Format: RESOLVE <causaId> <winningOptionIndex>. Only the creator can resolve their causa',
        category: 'Causae (Voting & Wagering)',
        icon: '&#128179;',
        example: 'RESOLVE 1 0'
      },
      {
        type: 'COMMISSIO',
        pattern: /^COMMISSIO/i,
        service: 'Commissio',
        method: 'createCommissio',
        description: 'Create a bounty task with escrowed reward. Format: COMMISSIO <title> | REWARD <amount> | EXPIRES <YYYY-MM-DD>. Reward and expiry are optional (defaults: &#8361;10, 30 days). Reward is held in escrow until completion',
        category: 'Commissiones (Bounty Tasks)',
        icon: '&#128203;',
        example: 'COMMISSIO Fix login bug | REWARD 50 | EXPIRES 2025-12-20'
      },
      {
        type: 'ACCEPT',
        pattern: /^ACCEPT/i,
        service: 'Commissio',
        method: 'acceptCommissio',
        description: 'Accept and claim an open commissio. Format: ACCEPT <commissionId>. Assigns the task to you and changes status to ASSIGNED',
        category: 'Commissiones (Bounty Tasks)',
        icon: '&#128203;',
        example: 'ACCEPT 3'
      },
      {
        type: 'COMPLETE',
        pattern: /^COMPLETE/i,
        service: 'Commissio',
        method: 'completeCommissio',
        description: 'Mark your assigned commissio as complete and claim the escrowed reward. Format: COMPLETE <commissionId>. Only the assignee can complete their task',
        category: 'Commissiones (Bounty Tasks)',
        icon: '&#128203;',
        example: 'COMPLETE 3'
      },
      {
        type: 'TRANSFER',
        pattern: /^TRANSFER/i,
        service: 'DispatchTable',
        method: 'TRANSFER',
        description: 'Send Wavebucks to another user. Format: TRANSFER <email> <amount>. Requires sufficient balance. Direct peer-to-peer transaction',
        category: 'Transfers',
        icon: '&#128184;',
        example: 'TRANSFER friend@example.com 25'
      }
    ];
  }

  return { getLexicon };
})();

// ============================================================================
// COMMAND PARSER TESTS
// ============================================================================

function testCommandParsers() {
  TestRunner.test('parseCausa - valid format', () => {
    const body = 'CAUSA Best pizza | Pepperoni | Mushrooms | CLOSE 2025-12-31 | MIN 5';
    const parsed = CommandParsers.parseCausa(body);

    TestRunner.assertEqual(parsed.title, 'Best pizza', 'Title should match');
    TestRunner.assert(parsed.options.includes('Pepperoni'), 'Should include Pepperoni');
    TestRunner.assert(parsed.options.includes('Mushrooms'), 'Should include Mushrooms');
    TestRunner.assertEqual(parsed.minWager, 5, 'Min wager should be 5');
    TestRunner.assert(parsed.closingDate instanceof Date, 'Closing date should be Date');
  });

  TestRunner.test('parseCausa - missing options throws', () => {
    TestRunner.assertThrows(() => {
      CommandParsers.parseCausa('CAUSA Just a title');
    }, 'Should throw when missing options');
  });

  TestRunner.test('parseVote - valid format', () => {
    const body = 'VOTE 1 2 10';
    const parsed = CommandParsers.parseVote(body);

    TestRunner.assertEqual(parsed.causaId, 1, 'Causa ID should be 1');
    TestRunner.assertEqual(parsed.option, 2, 'Option should be 2');
    TestRunner.assertEqual(parsed.wager, 10, 'Wager should be 10');
  });

  TestRunner.test('parseVote - invalid format throws', () => {
    TestRunner.assertThrows(() => {
      CommandParsers.parseVote('VOTE 1');
    }, 'Should throw on invalid format');
  });

  TestRunner.test('parseResolve - valid format', () => {
    const body = 'RESOLVE 1 2';
    const parsed = CommandParsers.parseResolve(body);

    TestRunner.assertEqual(parsed.causaId, 1, 'Causa ID should be 1');
    TestRunner.assertEqual(parsed.winningOption, 2, 'Winning option should be 2');
  });

  TestRunner.test('parseCommissio - valid format', () => {
    const body = 'COMMISSIO Fix bug | REWARD 50 | EXPIRES 2025-12-31';
    const parsed = CommandParsers.parseCommissio(body);

    TestRunner.assertEqual(parsed.title, 'Fix bug', 'Title should match');
    TestRunner.assertEqual(parsed.reward, 50, 'Reward should be 50');
    TestRunner.assert(parsed.expiry instanceof Date, 'Expiry should be Date');
  });

  TestRunner.test('parseCommissio - defaults work', () => {
    const body = 'COMMISSIO Fix bug';
    const parsed = CommandParsers.parseCommissio(body);

    TestRunner.assertEqual(parsed.title, 'Fix bug', 'Title should match');
    TestRunner.assertEqual(parsed.reward, 10, 'Default reward should be 10');
    TestRunner.assert(parsed.expiry instanceof Date, 'Should have default expiry');
  });

  TestRunner.test('parseAccept - valid format', () => {
    const body = 'ACCEPT 5';
    const parsed = CommandParsers.parseAccept(body);

    TestRunner.assertEqual(parsed.commissionId, 5, 'Commission ID should be 5');
  });

  TestRunner.test('parseComplete - valid format', () => {
    const body = 'COMPLETE 5';
    const parsed = CommandParsers.parseComplete(body);

    TestRunner.assertEqual(parsed.commissionId, 5, 'Commission ID should be 5');
  });

  TestRunner.test('parseTransfer - valid format', () => {
    const body = 'TRANSFER user@example.com 25';
    const parsed = CommandParsers.parseTransfer(body);

    TestRunner.assertEqual(parsed.to, 'user@example.com', 'Recipient should match');
    TestRunner.assertEqual(parsed.amount, 25, 'Amount should be 25');
  });

  TestRunner.test('parseTransfer - invalid format throws', () => {
    TestRunner.assertThrows(() => {
      CommandParsers.parseTransfer('TRANSFER user@example.com');
    }, 'Should throw when missing amount');
  });
}

// ============================================================================
// CONFIG TESTS
// ============================================================================

function testConfigLexicon() {
  TestRunner.test('Config.getLexicon() returns array', () => {
    const lexicon = Config.getLexicon();
    TestRunner.assert(Array.isArray(lexicon), 'Lexicon should be an array');
    TestRunner.assert(lexicon.length > 0, 'Lexicon should not be empty');
  });

  TestRunner.test('Lexicon entries have required fields', () => {
    const lexicon = Config.getLexicon();
    lexicon.forEach(entry => {
      TestRunner.assert(entry.type, 'Entry should have type');
      TestRunner.assert(entry.pattern, 'Entry should have pattern');
      TestRunner.assert(entry.pattern instanceof RegExp, 'Pattern should be RegExp');
    });
  });

  TestRunner.test('Lexicon includes core commands', () => {
    const lexicon = Config.getLexicon();
    const types = lexicon.map(e => e.type);

    ['HELP', 'QUOT', 'CAUSA', 'VOTE', 'COMMISSIO', 'TRANSFER'].forEach(cmd => {
      TestRunner.assert(types.includes(cmd), `Lexicon should include ${cmd}`);
    });
  });
}

// ============================================================================
// PATTERN MATCHING TESTS
// ============================================================================

function testPatternMatching() {
  TestRunner.test('HELP pattern matches variations', () => {
    const pattern = /^HELP|^AUXILIUM/i;
    TestRunner.assert(pattern.test('HELP'), 'Should match HELP');
    TestRunner.assert(pattern.test('help'), 'Should match lowercase help');
    TestRunner.assert(pattern.test('AUXILIUM'), 'Should match AUXILIUM');
    TestRunner.assert(pattern.test('auxilium'), 'Should match lowercase auxilium');
  });

  TestRunner.test('Command patterns are case insensitive', () => {
    const lexicon = Config.getLexicon();
    lexicon.forEach(entry => {
      const lowerCmd = entry.type.toLowerCase();
      TestRunner.assert(
        entry.pattern.test(lowerCmd),
        `${entry.type} pattern should match lowercase`
      );
    });
  });

  TestRunner.test('detectCommand logic', () => {
    const body = 'CAUSA Test | Option1 | Option2';
    const lexicon = Config.getLexicon();

    let matched = null;
    for (const entry of lexicon) {
      if (entry.pattern.test(body)) {
        matched = entry;
        break;
      }
    }

    TestRunner.assert(matched !== null, 'Should match a command');
    TestRunner.assertEqual(matched.type, 'CAUSA', 'Should match CAUSA command');
  });
}

// ============================================================================
// LEXICON METADATA TESTS
// ============================================================================

function testLexiconMetadata() {
  TestRunner.test('Lexicon entries have complete metadata', () => {
    const lexicon = Config.getLexicon();
    lexicon.forEach(entry => {
      TestRunner.assert(entry.category, `${entry.type} should have category`);
      TestRunner.assert(entry.icon, `${entry.type} should have icon`);
      TestRunner.assert(entry.example, `${entry.type} should have example`);
      TestRunner.assert(entry.description, `${entry.type} should have description`);
    });
  });

  TestRunner.test('Icons use HTML entities', () => {
    const lexicon = Config.getLexicon();
    lexicon.forEach(entry => {
      TestRunner.assert(
        entry.icon.includes('&#'),
        `${entry.type} icon should use HTML entity format`
      );
    });
  });

  TestRunner.test('All commands have examples', () => {
    const lexicon = Config.getLexicon();
    lexicon.forEach(entry => {
      TestRunner.assert(
        entry.example && entry.example.length > 0,
        `${entry.type} should have non-empty example`
      );
    });
  });

  TestRunner.test('Categories are properly organized', () => {
    const lexicon = Config.getLexicon();
    const categories = [...new Set(lexicon.map(e => e.category))];

    TestRunner.assert(categories.length >= 3, 'Should have at least 3 categories');
    TestRunner.assert(
      categories.includes('Balance & Information'),
      'Should have Balance & Information category'
    );
  });
}

// ============================================================================
// TEST RUNNER
// ============================================================================

function runAllTests() {
  Logger.log('Starting Scriba Senatus Local Test Suite\n');
  TestRunner.reset();

  Logger.log('Running Config tests...');
  testConfigLexicon();

  Logger.log('\nRunning CommandParser tests...');
  testCommandParsers();

  Logger.log('\nRunning Pattern Matching tests...');
  testPatternMatching();

  Logger.log('\nRunning Lexicon Metadata tests...');
  testLexiconMetadata();

  const summary = TestRunner.summary();

  if (summary.failed === 0) {
    Logger.log('\n🎉 All tests passed!');
  } else {
    Logger.log(`\n⚠️ ${summary.failed} test(s) failed`);
  }

  return summary;
}

// Run tests if executed directly
if (typeof module !== 'undefined' && require.main === module) {
  runAllTests();
}
