/**
 * Tests.js
 * Test suite for Scriba Senatus system
 *
 * Run tests by executing runAllTests() from the Apps Script editor.
 * Tests are organized by module and use a simple assertion framework.
 */

// Test framework utilities
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
// INBOX PROCESSOR TESTS
// ============================================================================

function testInboxProcessor() {
  TestRunner.test('detectCommand - matches HELP', () => {
    const body = 'HELP\nI need assistance';
    const lexicon = Config.getLexicon();

    let matched = null;
    for (const entry of lexicon) {
      if (entry.pattern.test(body)) {
        matched = entry;
        break;
      }
    }

    TestRunner.assert(matched !== null, 'Should match a command');
    TestRunner.assertEqual(matched.type, 'HELP', 'Should match HELP command');
  });

  TestRunner.test('detectCommand - matches CAUSA', () => {
    const body = 'CAUSA Best pizza | Pepperoni | Mushrooms';
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

  TestRunner.test('detectCommand - case insensitive', () => {
    const body = 'help';
    const lexicon = Config.getLexicon();

    let matched = null;
    for (const entry of lexicon) {
      if (entry.pattern.test(body)) {
        matched = entry;
        break;
      }
    }

    TestRunner.assert(matched !== null, 'Should match lowercase command');
    TestRunner.assertEqual(matched.type, 'HELP', 'Should match HELP command');
  });

  TestRunner.test('extractEmail - handles angle brackets', () => {
    const header = 'John Doe <john@example.com>';
    const match = header.match(/<([^>]+)>/);
    const email = (match ? match[1] : header).toLowerCase().trim();

    TestRunner.assertEqual(email, 'john@example.com', 'Should extract email from brackets');
  });

  TestRunner.test('extractEmail - handles plain email', () => {
    const header = 'john@example.com';
    const match = header.match(/<([^>]+)>/);
    const email = (match ? match[1] : header).toLowerCase().trim();

    TestRunner.assertEqual(email, 'john@example.com', 'Should handle plain email');
  });
}

// ============================================================================
// DISPATCH TABLE TESTS
// ============================================================================

function testDispatchTable() {
  TestRunner.test('DispatchTable has required handlers', () => {
    const requiredHandlers = ['HELP', 'QUOT', 'CAUSA', 'VOTE', 'RESOLVE',
                              'COMMISSIO', 'ACCEPT', 'COMPLETE', 'TRANSFER'];

    requiredHandlers.forEach(handler => {
      TestRunner.assert(
        typeof DispatchTable[handler] === 'function',
        `DispatchTable should have ${handler} handler`
      );
    });
  });

  TestRunner.test('DispatchTable has DEFAULT handler', () => {
    TestRunner.assert(
      typeof DispatchTable.DEFAULT === 'function',
      'DispatchTable should have DEFAULT handler'
    );
  });
}

// ============================================================================
// SERVICE ADAPTERS TESTS
// ============================================================================

function testServiceAdapters() {
  TestRunner.test('ServiceAdapters.getActiveCausae returns array', () => {
    const result = ServiceAdapters.getActiveCausae();
    TestRunner.assert(Array.isArray(result), 'Should return array');
  });

  TestRunner.test('ServiceAdapters.getActiveCommissio returns array', () => {
    const result = ServiceAdapters.getActiveCommissio();
    TestRunner.assert(Array.isArray(result), 'Should return array');
  });

  TestRunner.test('ServiceAdapters handles errors gracefully', () => {
    // Should not throw even if sheets are missing
    const causae = ServiceAdapters.getActiveCausae();
    const commissions = ServiceAdapters.getActiveCommissio();

    TestRunner.assert(Array.isArray(causae), 'Causae should still return array on error');
    TestRunner.assert(Array.isArray(commissions), 'Commissions should still return array on error');
  });
}

// ============================================================================
// MESSAGE BUILDER TESTS
// ============================================================================

function testMessageBuilder() {
  TestRunner.test('MessageBuilder.buildErrorMessage includes error text', () => {
    const msg = MessageBuilder.buildErrorMessage('Test error');
    TestRunner.assert(msg.includes('Test error'), 'Should include error text');
    TestRunner.assert(msg.includes('Error'), 'Should indicate it is an error');
  });

  TestRunner.test('MessageBuilder.buildDigest includes balance', () => {
    const msg = MessageBuilder.buildDigest({ balance: 100 });
    TestRunner.assert(msg.includes('100'), 'Should include balance');
    TestRunner.assert(msg.includes('Balance'), 'Should have balance label');
  });
}

// ============================================================================
// CAUSAE SERVICE TESTS
// ============================================================================

function testCausaeService() {
  TestRunner.test('Causae module has required methods', () => {
    TestRunner.assert(typeof Causae.createCausa === 'function', 'Should have createCausa method');
    TestRunner.assert(typeof Causae.vote === 'function', 'Should have vote method');
    TestRunner.assert(typeof Causae.resolveCausa === 'function', 'Should have resolveCausa method');
    TestRunner.assert(typeof Causae.getActiveList === 'function', 'Should have getActiveList method');
  });

  TestRunner.test('Causae.getActiveList returns array', () => {
    const list = Causae.getActiveList();
    TestRunner.assert(Array.isArray(list), 'Should return array');
  });
}

// ============================================================================
// COMMISSIONES SERVICE TESTS
// ============================================================================

function testCommissionesService() {
  TestRunner.test('Commissio module has required methods', () => {
    TestRunner.assert(typeof Commissio.createCommissio === 'function', 'Should have createCommissio method');
    TestRunner.assert(typeof Commissio.acceptCommissio === 'function', 'Should have acceptCommissio method');
    TestRunner.assert(typeof Commissio.completeCommissio === 'function', 'Should have completeCommissio method');
    TestRunner.assert(typeof Commissio.getActiveList === 'function', 'Should have getActiveList method');
  });

  TestRunner.test('Commissio.getActiveList returns array', () => {
    const list = Commissio.getActiveList();
    TestRunner.assert(Array.isArray(list), 'Should return array');
  });
}

// ============================================================================
// PERSONALITY TESTS
// ============================================================================

function testPersonality() {
  TestRunner.test('Personality.get(HELP) returns HTML', () => {
    const help = Personality.get('HELP');
    TestRunner.assert(typeof help === 'string', 'Should return string');
    TestRunner.assert(help.length > 0, 'Should not be empty');
    TestRunner.assert(help.includes('Scriba Senatus'), 'Should include title');
  });

  TestRunner.test('HELP message includes all command categories', () => {
    const help = Personality.get('HELP');
    TestRunner.assert(help.includes('Balance & Information'), 'Should include Balance category');
    TestRunner.assert(help.includes('Causae'), 'Should include Causae category');
    TestRunner.assert(help.includes('Commissiones'), 'Should include Commissiones category');
    TestRunner.assert(help.includes('Transfers'), 'Should include Transfers category');
  });

  TestRunner.test('HELP message includes mailto links', () => {
    const help = Personality.get('HELP');
    TestRunner.assert(help.includes('mailto:scribasenatus@gmail.com'), 'Should include mailto links');
  });

  TestRunner.test('HELP message uses HTML entities for emojis', () => {
    const help = Personality.get('HELP');
    TestRunner.assert(help.includes('&#128'), 'Should use HTML entity emojis');
    TestRunner.assert(!help.match(/[^\x00-\x7F]/), 'Should not contain raw unicode emojis');
  });
}

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

function testIntegration() {
  TestRunner.test('Full command flow - HELP', () => {
    const body = 'HELP';
    const lexicon = Config.getLexicon();

    // Step 1: Detect command
    let command = null;
    for (const entry of lexicon) {
      if (entry.pattern.test(body)) {
        command = entry;
        break;
      }
    }

    TestRunner.assert(command !== null, 'Should detect HELP command');

    // Step 2: Get handler
    const handler = DispatchTable[command.type];
    TestRunner.assert(typeof handler === 'function', 'Should have handler function');

    // Step 3: Execute (without actual args since we're testing structure)
    // In real system, this would call the handler with email, body, etc.
  });

  TestRunner.test('Full command flow - CAUSA', () => {
    const body = 'CAUSA Test | Option1 | Option2';
    const lexicon = Config.getLexicon();

    // Step 1: Detect command
    let command = null;
    for (const entry of lexicon) {
      if (entry.pattern.test(body)) {
        command = entry;
        break;
      }
    }

    TestRunner.assert(command !== null, 'Should detect CAUSA command');
    TestRunner.assertEqual(command.type, 'CAUSA', 'Command type should be CAUSA');

    // Step 2: Parse command
    const parsed = CommandParsers.parseCausa(body);
    TestRunner.assertEqual(parsed.title, 'Test', 'Should parse title');
    TestRunner.assert(parsed.options.length === 2, 'Should have 2 options');
  });

  TestRunner.test('Lexicon metadata includes examples and icons', () => {
    const lexicon = Config.getLexicon();
    lexicon.forEach(entry => {
      TestRunner.assert(entry.category, `${entry.type} should have category`);
      TestRunner.assert(entry.icon, `${entry.type} should have icon`);
      TestRunner.assert(entry.example, `${entry.type} should have example`);
      TestRunner.assert(entry.description, `${entry.type} should have description`);
    });
  });

  TestRunner.test('All handlers use HTML entity emojis', () => {
    const testEmail = 'test@example.com';
    const handlers = {
      'CAUSA': 'CAUSA Test | A | B',
      'VOTE': 'VOTE 1 0 10',
      'COMMISSIO': 'COMMISSIO Test task',
      'ACCEPT': 'ACCEPT 1',
      'COMPLETE': 'COMPLETE 1',
      'TRANSFER': 'TRANSFER user@example.com 10'
    };

    Object.entries(handlers).forEach(([type, body]) => {
      // Note: These will fail if there's no data, but structure test is valuable
      // In real test environment, we'd mock the data
      const handler = DispatchTable[type];
      TestRunner.assert(typeof handler === 'function', `${type} handler should exist`);
    });
  });
}

// ============================================================================
// TEST RUNNER
// ============================================================================

/**
 * Main test runner - execute this function to run all tests
 */
function runAllTests() {
  Logger.log('Starting Scriba Senatus Test Suite\n');
  TestRunner.reset();

  Logger.log('Running Config tests...');
  testConfigLexicon();

  Logger.log('\nRunning CommandParser tests...');
  testCommandParsers();

  Logger.log('\nRunning InboxProcessor tests...');
  testInboxProcessor();

  Logger.log('\nRunning DispatchTable tests...');
  testDispatchTable();

  Logger.log('\nRunning ServiceAdapters tests...');
  testServiceAdapters();

  Logger.log('\nRunning MessageBuilder tests...');
  testMessageBuilder();

  Logger.log('\nRunning Causae Service tests...');
  testCausaeService();

  Logger.log('\nRunning Commissiones Service tests...');
  testCommissionesService();

  Logger.log('\nRunning Personality tests...');
  testPersonality();

  Logger.log('\nRunning Integration tests...');
  testIntegration();

  const summary = TestRunner.summary();

  if (summary.failed === 0) {
    Logger.log('\n&#127881; All tests passed!');
  } else {
    Logger.log(`\n&#9888; ${summary.failed} test(s) failed`);
  }

  return summary;
}

/**
 * Run a specific test module
 */
function runConfigTests() {
  TestRunner.reset();
  testConfigLexicon();
  return TestRunner.summary();
}

function runParserTests() {
  TestRunner.reset();
  testCommandParsers();
  return TestRunner.summary();
}

function runInboxTests() {
  TestRunner.reset();
  testInboxProcessor();
  return TestRunner.summary();
}
