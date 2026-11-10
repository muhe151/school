import 'dotenv/config';
import { MongoClient } from 'mongodb';
import bcrypt from 'bcryptjs';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import crypto from 'node:crypto';

const rl=createInterface({input,output});
const client=new MongoClient(process.env.MONGO_URI||'mongodb://127.0.0.1:27017');
try{
  const name=(await rl.question('Administrator full name: ')).trim();
  const email=(await rl.question('Administrator email: ')).trim().toLowerCase();
  const password=await rl.question('Create a password (minimum 12 characters): ');
  if(name.length<2||!/^\S+@\S+\.\S+$/.test(email)||password.length<12)throw new Error('Use a full name, valid email, and password with at least 12 characters.');
  await client.connect();const users=client.db(process.env.MONGO_DB||'madda_walabu_school').collection('users');
  if(await users.countDocuments({role:'admin'}))throw new Error('An administrator already exists.');
  await users.insertOne({name,email,passwordHash:await bcrypt.hash(password,12),role:'admin',status:'Active',studentNumber:`MWA-A-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,createdAt:new Date(),updatedAt:new Date()});
  console.log(`Administrator account created for ${email}. Start the portal and sign in.`);
}catch(e){console.error(e.message||'Could not create administrator.');process.exitCode=1}
finally{rl.close();await client.close().catch(()=>{})}
