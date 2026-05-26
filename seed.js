const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('./models/User');
const Project = require('./models/Project');

dotenv.config();

const seedDatabase = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB Atlas');

    // Clear existing data
    await User.deleteMany();
    await Project.deleteMany();

    // Create a demo user
    const user = await User.create({
      name: 'Test User',
      email: 'test@test.com',
      password: 'test',
      role: 'buyer'
    });

    const seller = await User.create({
      name: 'Demo Seller',
      email: 'seller@test.com',
      password: 'test',
      role: 'seller'
    });

    // Create projects
    await Project.create([
      {
        title: 'E-Commerce React Template',
        shortDescription: 'A fully functional MERN e-commerce app.',
        detailedDescription: 'This is a complete MERN stack application with Redux, Stripe integration, and admin dashboard.',
        price: 49,
        techStack: ['React', 'Node.js', 'MongoDB', 'Express'],
        category: 'Web App',
        seller: seller._id,
        isApproved: true,
        demoUrl: 'https://example.com/ecommerce-demo'
      },
      {
        title: 'Modern Portfolio UI',
        shortDescription: 'Beautiful portfolio template for developers.',
        detailedDescription: 'Responsive and animated portfolio built with React and Framer Motion.',
        price: 19,
        techStack: ['HTML', 'CSS', 'React', 'Framer Motion'],
        category: 'Template',
        seller: seller._id,
        isApproved: true,
        demoUrl: 'https://example.com/portfolio-demo'
      }
    ]);

    console.log('Database Seeded Successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  }
};

seedDatabase();
