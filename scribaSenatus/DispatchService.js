/**
 * DispatchService.js
 * Defines routing between detected command types and services.
 * Maps commands from the Lexicon to their respective handlers.
 */

const DispatchTable = {

  'HELP': () => Personality.get('HELP'),

  'QUOT': (email) => {
    const balance = Wavebucks.getBalance(email);
    return MessageBuilder.buildDigest({ balance });
  },

  'CAUSA': (email, body) => {
    try {
      const parsed = CommandParsers.parseCausa(body);
      const causaId = Causae.createCausa(email, parsed.title, parsed.options, parsed.closingDate, parsed.minWager);
      return `<h2>&#9989; Causa Created</h2>
              <p><b>ID:</b> ${causaId}</p>
              <p><b>Title:</b> ${parsed.title}</p>
              <p><b>Options:</b> ${parsed.options.join(', ')}</p>
              <p><b>Closes:</b> ${parsed.closingDate.toDateString()}</p>
              <p><b>Minimum Wager:</b> &#8361;${parsed.minWager}</p>
              <p><i>Send VOTE to participate</i></p>`;
    } catch (err) {
      return MessageBuilder.buildErrorMessage(`Causa creation failed: ${err.message}`);
    }
  },

  'VOTE': (email, body) => {
    try {
      const parsed = CommandParsers.parseVote(body);
      Causae.vote(email, parsed.causaId, parsed.option, parsed.wager);
      return `<h2>&#9989; Vote Recorded</h2>
              <p><b>Causa ID:</b> ${parsed.causaId}</p>
              <p><b>Your Vote:</b> Option ${parsed.option}</p>
              <p><b>Wager:</b> &#8361;${parsed.wager}</p>
              <p><i>May fortuna favor your choice!</i></p>`;
    } catch (err) {
      return MessageBuilder.buildErrorMessage(`Vote failed: ${err.message}`);
    }
  },

  'RESOLVE': (email, body) => {
    try {
      const parsed = CommandParsers.parseResolve(body);
      const result = Causae.resolveCausa(parsed.causaId, parsed.winningOption, email);
      return `<h2>&#127942; Causa Resolved</h2>
              <p><b>Causa ID:</b> ${parsed.causaId}</p>
              <p><b>Winning Option:</b> ${result.winningOption}</p>
              <p><b>Total Pot:</b> &#8361;${result.totalPot}</p>
              <p><b>Winners:</b> ${result.winnersCount}</p>
              <p><i>Winnings have been distributed!</i></p>`;
    } catch (err) {
      return MessageBuilder.buildErrorMessage(`Resolve failed: ${err.message}`);
    }
  },

  'COMMISSIO': (email, body) => {
    try {
      const parsed = CommandParsers.parseCommissio(body);
      const commissionId = Commissio.createCommissio(email, parsed.title, parsed.reward, parsed.expiry);
      return `<h2>&#9989; Commissio Created</h2>
              <p><b>ID:</b> ${commissionId}</p>
              <p><b>Title:</b> ${parsed.title}</p>
              <p><b>Reward:</b> &#8361;${parsed.reward}</p>
              <p><b>Expires:</b> ${parsed.expiry.toDateString()}</p>
              <p><i>Send ACCEPT to claim this task</i></p>`;
    } catch (err) {
      return MessageBuilder.buildErrorMessage(`Commissio creation failed: ${err.message}`);
    }
  },

  'ACCEPT': (email, body) => {
    try {
      const parsed = CommandParsers.parseAccept(body);
      Commissio.acceptCommissio(email, parsed.commissionId);
      return `<h2>&#9989; Commissio Accepted</h2>
              <p><b>Commission ID:</b> ${parsed.commissionId}</p>
              <p>Task assigned to you. Send COMPLETE when finished.</p>`;
    } catch (err) {
      return MessageBuilder.buildErrorMessage(`Accept failed: ${err.message}`);
    }
  },

  'COMPLETE': (email, body) => {
    try {
      const parsed = CommandParsers.parseComplete(body);
      const reward = Commissio.completeCommissio(email, parsed.commissionId);
      return `<h2>&#9989; Commissio Completed</h2>
              <p><b>Commission ID:</b> ${parsed.commissionId}</p>
              <p><b>Reward Earned:</b> &#8361;${reward}</p>
              <p><i>Well done! Your balance has been credited.</i></p>`;
    } catch (err) {
      return MessageBuilder.buildErrorMessage(`Complete failed: ${err.message}`);
    }
  },

  'TRANSFER': (email, body) => {
    try {
      const parsed = CommandParsers.parseTransfer(body);

      // Check sender has sufficient balance
      const senderBalance = Wavebucks.getBalance(email);
      if (senderBalance < parsed.amount) {
        throw new Error(`Insufficient funds. Your balance: &#8361;${senderBalance}`);
      }

      // Execute transfer
      Wavebucks.debit(email, parsed.amount, `Transfer to ${parsed.to}`);
      Wavebucks.credit(parsed.to, parsed.amount, `Transfer from ${email}`);

      return `<h2>&#9989; Transfer Complete</h2>
              <p><b>To:</b> ${parsed.to}</p>
              <p><b>Amount:</b> &#8361;${parsed.amount}</p>
              <p><b>Your New Balance:</b> &#8361;${Wavebucks.getBalance(email)}</p>`;
    } catch (err) {
      return MessageBuilder.buildErrorMessage(`Transfer failed: ${err.message}`);
    }
  },

  'DEFAULT': () => MessageBuilder.buildErrorMessage("Unrecognized command.")
};
