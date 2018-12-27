# Hackerrank

Clone Repo:

    git clone https://github.com/chitreshgoyal1/hackerrank.git
    
    or

    direct download from: https://github.com/chitreshgoyal1/hackerrank
    select "clone or download" option
    and click on "Download Zip"
    
Bot saves princess :1

    Princess Peach is trapped in one of the four corners of a square grid. 
    You are in the center of the grid and can move one step at a time in any of the four directions.
    Can you rescue the princess?

    Input format
    The first line contains an odd integer N (3 <= N < 100) denoting the size of the grid.
    This is followed by an NxN grid. Each cell is denoted by '-' (ascii value: 45).
    The bot position is denoted by 'm' and the princess position is denoted by 'p'.

    Grid is indexed using Matrix Convention

    Output format
    Print out the moves you will take to rescue the princess in one go.
    The moves must be separated by '\n', a newline.
    The valid moves are LEFT or RIGHT or UP or DOWN.

    Sample input
    3
    ---
    -m-
    p--

    Sample output
    DOWN
    LEFT

    Task
    Complete the function displayPathtoPrincess which takes in two parameters
    - the integer N and the character array grid.
    The grid will be formatted exactly as you see it in the input,
    so for the sample input the princess is at grid[2][0].
    The function shall output moves (LEFT, RIGHT, UP or DOWN) on consecutive lines to rescue/reach the princess.
    The goal is to reach the princess in as few moves as possible.
    The above sample input is just to help you understand the format. 
    The princess ('p') can be in any one of the four corners.
    Scoring
    Your score is calculated as follows : 
    (NxN - number of moves made to rescue the princess)/10, 
    where N is the size of the grid (3x3 in the sample testcase).

How to play - Princess 1

    Provide user input in file as below:
    n = size of matix 
        { should be a odd number, 
          should be greater than 3, 
          should be less than 100 }
    grid = input a grid of n x n size
    *p = denote position of princess in matix
    *m = denote position of bot in matix

    example:
    n = 5
    grid = [['p','-','-','-','-'],['-','-','-','-','-'],['-','-','m','-','-'],['-','-','-','-','-'],['-','-','-','-','-']]

    Execute game (on console):
    ruby princess1.rb

    your output should look like this:
    LEFT
    LEFT
    UP
    UP

Bot saves princess :2

    In this version of "Bot saves princess", Princess Peach and bot's position are randomly set.
    Can you save the princess?

    Task
    Complete the function nextMove which takes in 4 parameters
    - an integer N, integers r and c indicating the row & column position
    of the bot and the character array grid - and outputs the next move
    the bot makes to rescue the princess.

    Input Format
    The first line of the input is N (<100), the size of the board (NxN).
    The second line of the input contains two space separated integers, which is the position of the bot.

    Grid is indexed using Matrix Convention

    The position of the princess is indicated by the character 'p' and the
    position of the bot is indicated by the character 'm' and each cell is denoted by '-' (ascii value: 45).

    Output Format
    Output only the next move you take to rescue the princess.
    Valid moves are LEFT, RIGHT, UP or DOWN

    Sample Input
    5
    2 3
    -----
    -----
    p--m-
    -----
    -----

    Sample Output
    LEFT

    Resultant State
    -----
    -----
    p-m--
    -----
    -----
    
    Explanation
    As you can see, bot is one step closer to the princess.
    
    Scoring
    Your score for every testcase would be 
    (NxN minus number of moves made to rescue the princess)/10
    where N is the size of the grid (5x5 in the sample testcase).
    Maximum score is 17.5 


How to play - Princess 2

    Provide user input in file as below:
    n = size of matix 
        { should be integer value, 
          should be less than 100 }
    grid = input a grid of n x n size
    *p = denote position of princess in matix
    *m = denote position of bot in matix

    example:
    grid = [['-','-','-','p','-'],['-','-','-','-','-'],['-','-','-','-','-'],['m','-','-','-','-'],['-','-','-','-','-']]

    Execute game (On console):
    ruby princess2.rb

    your output should look like this:
    
    RIGHT
    RIGHT
    RIGHT
    UP
    UP
    UP