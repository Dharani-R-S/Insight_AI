with open('server/index.js', 'r', encoding='utf-8') as f:
    lines = f.readlines()

signup_start = -1
signup_end = -1
login_start = -1
login_end = -1

for i, line in enumerate(lines):
    if "app.post('/api/auth/signup'" in line:
        signup_start = i
    if signup_start != -1 and signup_end == -1 and line.strip() == "});":
        signup_end = i
    if "app.post('/api/auth/login'" in line:
        login_start = i
    if login_start != -1 and login_end == -1 and line.strip() == "});":
        login_end = i

print(f"signup: {signup_start} to {signup_end}, login: {login_start} to {login_end}")

new_signup = """app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password } = req.body || {};
  const cleanName = typeof name === 'string' ? name.trim() : '';
  const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!cleanName || !cleanEmail || !password) {
    return res.status(400).json({ error: 'Name, email and password are required.' });
  }
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  try {
    const users = getUsers();
    const existing = Array.isArray(users) && users.find(u => u && u.email && String(u.email).toLowerCase() === cleanEmail);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const user = {
      id: Date.now(),
      name: cleanName,
      email: cleanEmail,
      password_hash,
      created_at: new Date().toISOString()
    };
    users.push(user);
    saveUsers(users);

    const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    console.log(`✅ New user registered: ${cleanEmail}`);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    console.error('❌ Signup error:', err);
    res.status(500).json({ error: 'Signup failed. Please try again: ' + (err.message || 'Server error') });
  }
});
"""

new_login = """app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!cleanEmail || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const users = getUsers();
    const row = Array.isArray(users) && users.find(u => u && u.email && String(u.email).toLowerCase() === cleanEmail);
    if (!row) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const valid = await bcrypt.compare(password, row.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = { id: row.id, name: row.name, email: row.email };
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user });
  } catch (err) {
    console.error('❌ Login error:', err);
    res.status(500).json({ error: 'Login failed. Please try again: ' + (err.message || 'Server error') });
  }
});
"""

# Replace in reverse order so indices don't shift
lines[login_start:login_end + 1] = [new_login]
lines[signup_start:signup_end + 1] = [new_signup]

with open('server/index.js', 'w', encoding='utf-8') as f:
    f.writelines(lines)
print('Successfully updated signup and login handlers in server/index.js')

