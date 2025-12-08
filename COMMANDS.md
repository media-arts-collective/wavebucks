# Scriba Senatus Command Reference

This document describes all available email commands for the Scriba Senatus system.

## Basic Commands

### HELP
Get help and instructions.

**Format:**
```
HELP
```

### QUOT (Balance Check)
Check your Wavebucks balance and view active Causae and Commissiones.

**Format:**
```
QUOT
```

**Aliases:** `BALANCE`

---

## Transfer Commands

### TRANSFER
Send Wavebucks to another user.

**Format:**
```
TRANSFER
To: recipient@example.com
Amount: 25
```

**Rules:**
- You must have sufficient balance
- Amount must be positive
- Recipient will be credited immediately

---

## Causae (Voting/Wagering) Commands

### CAUSA (Create)
Create a new collective voting opportunity with wagering.

**Format:**
```
CAUSA
Title: Should we fund project X?
Options: YES, NO, ABSTAIN
Closing: 2025-12-15
MinWager: 5
```

**Rules:**
- Title is required
- At least one option required (comma-separated)
- Closing date must be in format YYYY-MM-DD
- MinWager defaults to 1 if not specified

### VOTE
Vote on an active Causa with a wager.

**Format:**
```
VOTE
CausaID: 3
Option: YES
Wager: 10
```

**Rules:**
- Causa must be OPEN
- Option must match one of the valid options
- Wager must meet minimum requirement
- You can only vote once per Causa
- Wager is immediately debited from your balance

### RESOLVE
Resolve a Causa by declaring the winning option (creator only).

**Format:**
```
RESOLVE
CausaID: 3
WinningOption: YES
```

**Rules:**
- Only the Causa creator can resolve
- Winning option must be valid
- Pot is distributed proportionally to winners
- Causa status changes to RESOLVED

---

## Commissiones (Bounty Tasks) Commands

### COMMISSIO (Create)
Create a bounty task with a reward.

**Format:**
```
COMMISSIO
Title: Build new feature X
Reward: 50
Expiry: 2025-12-31
```

**Rules:**
- You must have sufficient balance for reward
- Reward is immediately escrowed (debited)
- Expiry date must be in format YYYY-MM-DD

### ACCEPT
Accept and claim an available Commissio.

**Format:**
```
ACCEPT
CommissionID: 5
```

**Rules:**
- Commissio must be OPEN
- Cannot accept expired tasks
- Task becomes ASSIGNED to you

### COMPLETE
Mark your assigned Commissio as complete and claim reward.

**Format:**
```
COMPLETE
CommissionID: 5
```

**Rules:**
- Commissio must be ASSIGNED to you
- Reward is immediately credited
- Task status changes to COMPLETED

---

## Sheet Structure

### Causae Sheet
| Column | Name | Description |
|--------|------|-------------|
| A | ID | Auto-increment |
| B | Title | Causa description |
| C | Options | Comma-separated valid options |
| D | Creator Email | Who created it |
| E | Status | OPEN, RESOLVED |
| F | MinWager | Minimum wager amount |
| G | Created Date | When created |
| H | Closing Date | When voting closes |
| I | Winning Option | Set on resolve |
| J | Notes | Optional notes |

### Votes Sheet (auto-created)
| Column | Name | Description |
|--------|------|-------------|
| A | VoteID | Auto-increment |
| B | CausaID | Which causa |
| C | Email | Voter email |
| D | Option | Their choice |
| E | Wager | Amount wagered |
| F | Timestamp | When voted |

### Commissiones Sheet
| Column | Name | Description |
|--------|------|-------------|
| A | ID | Auto-increment |
| B | Title | Task description |
| C | Creator Email | Who created it |
| D | Reward | Wavebucks reward |
| E | Expiry Date | Deadline |
| F | Status | OPEN, ASSIGNED, COMPLETED, EXPIRED |
| G | Assigned To | Who accepted it |
| H | Created Date | When created |
| I | Completed Date | When finished |
| J | Notes | Optional notes |

---

## Lexicon Configuration

Add these entries to your Lexicon tab:

| command | pattern | service | method |
|---------|---------|---------|--------|
| HELP | ^HELP\|^AUXILIUM | Personality | HELP |
| QUOT | ^QUOT\|^BALANCE | InboxProcessor | QUOT |
| CAUSA | ^CAUSA | DispatchTable | CAUSA |
| VOTE | ^VOTE | DispatchTable | VOTE |
| RESOLVE | ^RESOLVE | DispatchTable | RESOLVE |
| COMMISSIO | ^COMMISSIO | DispatchTable | COMMISSIO |
| ACCEPT | ^ACCEPT | DispatchTable | ACCEPT |
| COMPLETE | ^COMPLETE | DispatchTable | COMPLETE |
| TRANSFER | ^TRANSFER | DispatchTable | TRANSFER |

---

## Testing Workflow

1. **Setup sheets** - Ensure Causae, Commissiones tabs exist with headers
2. **Configure Lexicon** - Add command patterns as shown above
3. **Test HELP** - Verify personality templates load
4. **Test QUOT** - Check balance retrieval works
5. **Test TRANSFER** - Verify Wavebucks credit/debit
6. **Test CAUSA flow** - Create → Vote → Resolve
7. **Test COMMISSIO flow** - Create → Accept → Complete
8. **Check logs** - Verify all transactions recorded

---

## Troubleshooting

**"Command not found"**
- Check Lexicon tab has the command pattern
- Verify pattern regex matches your email body

**"Sheet not found"**
- Ensure all required tabs exist: Config, Lexicon, Personality, Causae, Commissiones
- Votes sheet is auto-created on first vote

**"Insufficient funds"**
- Check balance with QUOT command
- Ensure Wavebucks library is properly linked

**"Only creator can resolve"**
- RESOLVE command can only be sent by the email that created the Causa
- Consider adding admin override if needed
