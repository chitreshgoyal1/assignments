# ---------------------------------------------------------------
#  Using Ruby generate an N x N grid,
#  where N can be any number, and
#  randomly populate the grid with letters (A-Z).
#
#  Using the provided dictionary file find all:
#
#  Horizontal words from left to right in your grid
#  Horizontal words from right to left in your grid
#  Vertical words from top to bottom in your grid
#  Vertical words from bottom to top in your grid
#  Diagonal words from left to right in your grid
#  Diagonal words from right to left in your grid
# ---------------------------------------------------------------

# require 'rubocop'
# require 'benchmark'
# require 'pry'

# Define direction, x axis, y axis
DIRECTION = ['Diagonal-Bottom-Top-Right-Left', 'Bottom-Top', 'Diagonal-Bottom-Top-Left-Right', 'Right-Left', 'Left-Right', 'Diagonal-Top-Bottom-Right-Left', 'Top-Bottom',
             'Diagonal-Top-Bottom-Left-Right'].freeze
X = [-1, -1, -1, 0, 0,  1, 1, 1].freeze
Y = [-1, 0,  1, -1, 1, -1, 0, 1].freeze

def search_direction(matrix, n, row, col, word)
  # If first character of word doesn't match with point in grid just return false
  return false if matrix[row][col] != word.chars.first

  word_length = word.chars.length - 1

  # print "First character #{word.chars.first} found at #{row},#{col} now check in all 8 directions \n"
  (0..8 - 1).each do |dir|
    found = ["#{word.chars.first}-> #{row},#{col}"]
    # Initialize starting point for current direction
    rd = row + X[dir]
    cd = col + Y[dir]
    # First character is already checked, match remaining characters
    word_search = 0
    (1..word_length).each do |itr|
      break if rd >= n || rd < 0 || cd >= n || cd < 0 # Break if out of matrix
      break if matrix[rd][cd] != word.chars[itr] # Break if not matched

      found << "#{word.chars[itr]}-> #{rd},#{cd}"
      word_search = itr

      # Move in direction
      rd += X[dir]
      cd += Y[dir]
    end

    # If all character matched, then value of must be equal to length of word
    return found.unshift("#{word} -> #{DIRECTION[dir]} (#{X[dir]}:#{Y[dir]})") if word_search == word_length
  end

  false
end

def search_in_matrix(matrix, n, word)
  (0..n - 1).each do |r|
    (0..n - 1).each do |c|
      return search_direction(matrix, n, r, c, word) if search_direction(matrix, n, r, c, word)
    end
  end
  false
end

# ------ Start code here ------
print 'Please enter size of matrix: '
n = gets.chomp.to_i
matrix = Array.new(n) { Array.new(n) { Array('A'..'Z').sample } }

# Sample matrix contains word RAAM, CHIT
#   matrix = [
#     %w[N N M B A C],
#     %w[E I M D R M],
#     %w[L M F A A C],
#     %w[P L A A A H],
#     %w[P M A M D I],
#     %w[A X F A B T]
#   ]
puts matrix.to_a.map(&:inspect)

# Code to read first word line by line from file
def read_first_word_of_each_line_from(matrix, n, input_file)
  lines = File.readlines(input_file).reject(&:empty?)
       #File.read(input_file).lines.map { |l| l.split.first }
  lines.map do |line|
    word = line.split.first
    puts search_in_matrix(matrix, n, word) if !word.nil? && search_in_matrix(matrix, n, word)
  end
  '---- End -----'
end

read_first_word_of_each_line_from(matrix, n, 'dict.txt')
